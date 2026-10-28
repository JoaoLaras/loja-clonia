//Ligar banco e servidor //* node --env-file=.env servidor.js
// Carrega o módulo HTTP e o pacote de acesso ao PostgreSQL.
const http = require("node:http");
const pg = require("pg");
// Permite ler arquivos usando await.
const fs = require("node:fs/promises");
// Permite montar caminhos de arquivos.
const path = require("node:path");

// Administra as conexões usadas nas consultas.
// Usa as configurações PG... carregadas do arquivo .env.
const banco = new pg.Pool();

// Lista compartilhada pelas funções do servidor.
const tamanhosPermitidos = [
    "P", "M", "G", "GG",
    "40", "42", "44", "46", "48", "50", "52", "54"
];

//Inicio das funções do servidor HTTP

// Cadastra um novo produto no banco de dados.
async function cadastrarProduto(requisicao, resposta) {

    // Lê os dados recebidos como texto UTF-8.
    requisicao.setEncoding("utf8");

    // Acumula o conteúdo enviado pelo formulário.
    let corpo = "";

    for await (const parteCadastro of requisicao) {
        corpo += parteCadastro;
    }

    // Interpreta os dados enviados pelo formulário.
    const dados = new URLSearchParams(corpo);

    // Obtém os campos e remove espaços das extremidades.
    const modelo = (dados.get("modelo") || "").trim();
    const tamanho = (dados.get("tamanho") || "").trim();
    const cor = (dados.get("cor") || "").trim();

    // Verifica se os campos obrigatórios foram preenchidos.
    if (modelo === "" || tamanho === "" || cor === "") {

        await enviarMensagem(
            "Campos obrigatórios",
            "Informe modelo, tamanho e cor.",
            400,
            resposta
        );
        return;
    }

    // Padroniza o tamanho para letras maiúsculas.
    const tamanhoPadronizado = tamanho.toUpperCase();

    // Verifica se o tamanho pertence à lista permitida.
    if (!tamanhosPermitidos.includes(tamanhoPadronizado)) {

        await enviarMensagem(
            "Tamanho inválido",
            "Use P, M, G, GG ou 40, 42, 44, 46, 48, 50, 52, 54.",
            400,
            resposta
        );
        return;
    }

    try {

        // Carrega a página de confirmação do cadastro de produto.
        const caminhoHtml = path.join(__dirname, "produto-cadastro-sucesso.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Insere o produto com quantidade inicial zero.
        const resultado = await banco.query(
            `INSERT INTO produto (modelo, tamanho, cor, quantidade)
             VALUES ($1, $2, $3, 0)
             RETURNING id_produto`,
            [modelo, tamanhoPadronizado, cor]
        );

        // Obtém o código gerado pelo PostgreSQL.
        const codigoCriado = resultado.rows[0].id_produto;

        // Monta a confirmação com o link para consultar o produto.
        const dadosCadastro = `
            <p>Código do produto: ${escaparHtml(codigoCriado)}</p>
            <p>
                <a href="/produtos/consultar?codigo=${codigoCriado}">
                    Consultar produto cadastrado
                </a>
            </p>
        `;

        // Substitui o marcador da página pelos dados do cadastro.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- DADOS_CADASTRO -->",
            () => dadosCadastro
        );

        // Retorna HTTP 201 informando que o produto foi criado.
        resposta.writeHead(201, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Trata a violação da restrição UNIQUE do banco.
        if (erro.code === "23505") {

            await enviarMensagem(
                "Produto duplicado",
                "Já existe um produto com esse modelo, tamanho e cor.",
                409,
                resposta
            );
            return;
        }

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao cadastrar produto:", erro.message);

        await enviarMensagem(
            "Erro ao cadastrar produto",
            "Não foi possível cadastrar o produto.",
            500,
            resposta
        );
        return;
    }
}

// Consulta um produto pelo código informado na URL.
async function consultarProduto(requisicao, resposta) {

    // Interpreta a URL para acessar seus parâmetros.
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Obtém o código informado e remove espaços das extremidades.
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Verifica se o código foi informado.
    if (codigoRecebido === "") {

        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do produto.",
            400,
            resposta
        );
        return;
    }

    // Converte o código recebido para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Verifica se o código é um inteiro positivo dentro do limite do PostgreSQL.
    if (!Number.isSafeInteger(codigoPesquisado) ||
        codigoPesquisado <= 0 ||
        codigoPesquisado > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }

    try {

        // Consulta o produto utilizando um parâmetro SQL.
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
             FROM produto
             WHERE id_produto = $1`,
            [codigoPesquisado]
        );

        // Verifica se o produto foi encontrado.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém o primeiro registro retornado pela consulta.
        const produtoEncontrado = resultado.rows[0];

        // Monta os dados que serão apresentados no HTML.
        const dadosProduto = `
            <p>Código: ${escaparHtml(produtoEncontrado.id_produto)}</p>
            <p>Modelo: ${escaparHtml(produtoEncontrado.modelo)}</p>
            <p>Tamanho: ${escaparHtml(produtoEncontrado.tamanho)}</p>
            <p>Cor: ${escaparHtml(produtoEncontrado.cor)}</p>
            <p>Quantidade: ${escaparHtml(produtoEncontrado.quantidade)}</p>
        `;

        // Carrega a página de consulta do produto.
        const caminhoHtml = path.join(__dirname, "produto-consulta.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Insere os dados e o código do produto nos marcadores.
        const paginaPreenchida = paginaHtml
            .replace("<!-- DADOS_PRODUTO -->", () => dadosProduto)
            .replace(
                "<!-- CODIGO_PRODUTO -->",
                () => escaparHtml(produtoEncontrado.id_produto)
            );

        // Envia a página preenchida ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao consultar produto:", erro.message);

        await enviarMensagem(
            "Erro ao consultar produto",
            "Não foi possível consultar o produto.",
            500,
            resposta
        );
    }
}

// Lista os produtos cadastrados aplicando os filtros informados.
async function listarProdutos(requisicao, resposta) {

    // Interpreta a URL para acessar os filtros da pesquisa.
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Obtém os filtros enviados pelo navegador.
    const modeloFiltro = (endereco.searchParams.get("modelo") || "").trim();
    const corFiltro = (endereco.searchParams.get("cor") || "").trim();
    const tamanhoFiltro = (endereco.searchParams.get("tamanho") || "").trim().toUpperCase();

    try {

        // Consulta os produtos utilizando filtros parametrizados.
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
             FROM produto
             WHERE modelo ILIKE $1
               AND cor ILIKE $2
               AND ($3 = '' OR tamanho = $3)
             ORDER BY id_produto`,
            [
                "%" + modeloFiltro + "%",
                "%" + corFiltro + "%",
                tamanhoFiltro
            ]
        );

        // Acumula as linhas que serão inseridas na tabela HTML.
        let listaProdutos = "";

        // Monta uma mensagem quando nenhum produto for encontrado.
        if (resultado.rows.length === 0) {

            listaProdutos = `
                <tr>
                    <td colspan="5">
                        Nenhum produto encontrado para a pesquisa.
                    </td>
                </tr>
            `;
        }

        // Percorre os produtos retornados pelo banco.
        for (const produto of resultado.rows) {

            // Monta uma linha da tabela para cada produto.
            listaProdutos += `
                <tr>
                    <td>
                        <a href="/produtos/consultar?codigo=${produto.id_produto}">
                            ${escaparHtml(produto.id_produto)}
                        </a>
                    </td>
                    <td>${escaparHtml(produto.modelo)}</td>
                    <td>${escaparHtml(produto.tamanho)}</td>
                    <td>${escaparHtml(produto.cor)}</td>
                    <td>${escaparHtml(produto.quantidade)}</td>
                </tr>
            `;
        }

        // Carrega a estrutura HTML da listagem de produtos.
        const caminhoHtml = path.join(__dirname, "produto-listagem.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Substitui o marcador pelas linhas montadas.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- LINHAS_PRODUTOS -->",
            () => listaProdutos
        );

        // Envia a página com os produtos.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao listar produtos:", erro.message);

        await enviarMensagem(
            "Erro ao listar produtos",
            "Não foi possível listar os produtos.",
            500,
            resposta
        );
    }
}

// Carrega o formulário de edição de um produto.
async function mostrarFormularioEdicaoProduto(requisicao, resposta) {

    // Interpreta a URL para acessar o código do produto.
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Obtém o código enviado pelo navegador.
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Verifica se o código foi informado.
    if (codigoRecebido === "") {

        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do produto.",
            400,
            resposta
        );
        return;
    }

    // Converte o código para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Verifica se o código é válido para o campo INTEGER.
    if (!Number.isSafeInteger(codigoPesquisado) ||
        codigoPesquisado <= 0 ||
        codigoPesquisado > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }

    try {

        // Consulta os dados do produto que será editado.
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
             FROM produto
             WHERE id_produto = $1`,
            [codigoPesquisado]
        );

        // Verifica se o produto existe.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém os dados do produto encontrado.
        const produtoEncontrado = resultado.rows[0];

        // Acumula as opções de tamanho para o formulário.
        let opcoesTamanho = "";

        for (const tamanho of tamanhosPermitidos) {

            // Identifica o tamanho que já está cadastrado no produto.
            const selecionado = tamanho === produtoEncontrado.tamanho ? "selected" : "";

            opcoesTamanho += `
                <option value="${escaparHtml(tamanho)}" ${selecionado}>
                    ${escaparHtml(tamanho)}
                </option>
            `;
        }

        // Carrega a página de edição.
        const caminhoHtml = path.join(__dirname, "produto-editar.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Preenche o formulário com os valores atuais do produto.
        const paginaPreenchida = paginaHtml
            .replace("<!-- MODELO_PRODUTO -->", () => escaparHtml(produtoEncontrado.modelo))
            .replace("<!-- COR_PRODUTO -->", () => escaparHtml(produtoEncontrado.cor))
            .replace("<!-- OPCOES_TAMANHO -->", () => opcoesTamanho)
            .replaceAll(
                "<!-- CODIGO_PRODUTO -->",
                () => escaparHtml(produtoEncontrado.id_produto)
            );

        // Envia a página de edição ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao abrir edição do produto:", erro.message);

        await enviarMensagem(
            "Erro ao editar produto",
            "Não foi possível carregar os dados do produto.",
            500,
            resposta
        );
    }
}

// Atualiza os dados de um produto existente.
async function atualizarProduto(requisicao, resposta) {

    // Lê os dados enviados pelo formulário em UTF-8.
    requisicao.setEncoding("utf8");

    // Acumula o conteúdo recebido na requisição.
    let corpo = "";

    for await (const dadosAtualiza of requisicao) {
        corpo += dadosAtualiza;
    }

    // Interpreta os campos enviados pelo formulário.
    const dados = new URLSearchParams(corpo);

    // Obtém e converte o código do produto.
    const codigoRecebido = (dados.get("codigo") || "").trim();
    const codigoProduto = Number(codigoRecebido);

    // Verifica se o código é um inteiro válido.
    if (!Number.isSafeInteger(codigoProduto) ||
        codigoProduto <= 0 ||
        codigoProduto > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }

    // Obtém os campos que serão atualizados.
    const modelo = (dados.get("modelo") || "").trim();
    const tamanho = (dados.get("tamanho") || "").trim();
    const cor = (dados.get("cor") || "").trim();

    // Verifica se os campos obrigatórios foram preenchidos.
    if (modelo === "" || tamanho === "" || cor === "") {

        await enviarMensagem(
            "Campos obrigatórios",
            "Informe modelo, tamanho e cor.",
            400,
            resposta
        );
        return;
    }

    // Padroniza o tamanho para letras maiúsculas.
    const tamanhoPadronizado = tamanho.toUpperCase();

    // Verifica se o tamanho informado é permitido.
    if (!tamanhosPermitidos.includes(tamanhoPadronizado)) {

        await enviarMensagem(
            "Tamanho inválido",
            "Use P, M, G, GG ou 40, 42, 44, 46, 48, 50, 52, 54.",
            400,
            resposta
        );
        return;
    }

    try {

        // Carrega a página de confirmação da atualização do produto.
        const caminhoHtml = path.join(__dirname, "produto-atualizacao-sucesso.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Atualiza o produto identificado pelo código.
        const resultado = await banco.query(
            `UPDATE produto
             SET modelo = $1,
                 tamanho = $2,
                 cor = $3
             WHERE id_produto = $4
             RETURNING id_produto`,
            [modelo, tamanhoPadronizado, cor, codigoProduto]
        );

        // Verifica se algum registro foi atualizado.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém o código do produto atualizado.
        const codigoAtualizado = resultado.rows[0].id_produto;

        // Monta a confirmação com um link para consultar o produto.
        const dadosAtualizacao = `
            <p>Código do produto: ${escaparHtml(codigoAtualizado)}</p>
            <p>
                <a href="/produtos/consultar?codigo=${codigoAtualizado}">
                    Consultar produto atualizado
                </a>
            </p>
        `;

        // Insere os dados da atualização na página de confirmação.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- DADOS_ATUALIZADO -->",
            () => dadosAtualizacao
        );

        // Retorna HTTP 200 informando que a atualização foi realizada.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Trata combinações duplicadas de modelo, tamanho e cor.
        if (erro.code === "23505") {

            await enviarMensagem(
                "Produto duplicado",
                "Já existe um produto com esse modelo, tamanho e cor.",
                409,
                resposta
            );
            return;
        }

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao atualizar produto:", erro.message);

        await enviarMensagem(
            "Erro ao atualizar produto",
            "Não foi possível atualizar o produto.",
            500,
            resposta
        );
        return;
    }
}

// Cadastra um novo cliente no banco de dados.
async function cadastrarCliente(requisicao, resposta) {

    // Lê os dados recebidos como texto UTF-8.
    requisicao.setEncoding("utf8");

    // Acumula os dados enviados pelo formulário.
    let corpo = "";

    for await (const parteCadastro of requisicao) {
        corpo += parteCadastro;
    }

    // Interpreta os campos enviados pelo formulário.
    const dados = new URLSearchParams(corpo);

    // Obtém os dados do cliente e remove espaços das extremidades.
    const nome = (dados.get("nome") || "").trim();
    const cpf = (dados.get("cpf") || "").trim();
    const endereco = (dados.get("endereco") || "").trim();
    const telefone = (dados.get("telefone") || "").trim();
    const email = (dados.get("email") || "").trim();

    // Verifica se o nome obrigatório foi informado.
    if (nome === "") {

        await enviarMensagem(
            "Nome obrigatório",
            "Informe o nome do cliente.",
            400,
            resposta
        );
        return;
    }

    // Remove pontos, traços e espaços do CPF.
    const cpfPadronizado = cpf
        .replaceAll(".", "")
        .replaceAll("-", "")
        .replaceAll(" ", "");

    // Verifica o CPF somente quando ele foi informado.
    if (cpfPadronizado !== "") {

        const cpfValido = validarCpf(cpfPadronizado);

        if (cpfValido === false) {

            await enviarMensagem(
                "CPF inválido",
                "Informe um CPF válido ou deixe o campo vazio.",
                400,
                resposta
            );
            return;
        }
    }

    // Utiliza NULL no banco quando o CPF não for informado.
    const cpfBanco = cpfPadronizado === "" ? null : cpfPadronizado;

    try {

        // Carrega a página de confirmação do cadastro de cliente.
        const caminhoHtml = path.join(__dirname, "cliente-cadastro-sucesso.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Insere o cliente e retorna o código gerado pelo banco.
        const resultado = await banco.query(
            `INSERT INTO cliente (nome, cpf, endereco, telefone, email)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id_cliente`,
            [nome, cpfBanco, endereco, telefone, email]
        );

        // Obtém o código do cliente cadastrado.
        const codigoCliente = resultado.rows[0].id_cliente;

        // Monta os dados de confirmação do cadastro.
        const dadosCadastro = `
            <p>Código do cliente: ${escaparHtml(codigoCliente)}</p>
        `;

        // Substitui o marcador pelos dados gerados.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- DADOS_CADASTRO -->",
            () => dadosCadastro
        );

        // Retorna HTTP 201 informando que o cliente foi criado.
        resposta.writeHead(201, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Trata a violação da restrição UNIQUE do CPF.
        if (erro.code === "23505") {

            await enviarMensagem(
                "Cliente com CPF duplicado",
                "Já existe um cliente com esse CPF.",
                409,
                resposta
            );
            return;
        }

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao cadastrar cliente:", erro.message);

        await enviarMensagem(
            "Erro ao cadastrar cliente",
            "Não foi possível cadastrar o cliente.",
            500,
            resposta
        );
        return;
    }
}

// Consulta um cliente pelo código informado na URL.
async function  consultarCliente(requisicao, resposta) {

    // Interpreta a URL para acessar seus parâmetros.
    const endereco = new URL(requisicao.url, "http://localhost:3000");
    
    // Obtém o código informado e remove espaços das extremidades.
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Verifica se o código foi informado.
    if (codigoRecebido === "") {

        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do cliente.",
            400,
            resposta
        );
        return;
    }

    // Converte o código recebido para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Verifica se o código é um inteiro positivo dentro do limite do PostgreSQL.
    if (!Number.isSafeInteger(codigoPesquisado) ||
        codigoPesquisado <= 0 ||
        codigoPesquisado > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }
    
    try { 
        
        // Consulta o cliente utilizando um parâmetro SQL.
        const resultado = await banco.query(
            `SELECT id_cliente, nome, cpf, endereco, email, telefone
             FROM cliente
             WHERE id_cliente = $1`,
            [codigoPesquisado]
        );    

        // Verifica se o cliente foi encontrado.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Cliente não encontrado",
                "Nenhum cliente corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém o primeiro registro retornado pela consulta.
        const clienteEncontrado = resultado.rows[0];

        // Monta os dados que serão apresentados no HTML.
        const dadosCliente = `
            <p>Código: ${escaparHtml(clienteEncontrado.id_cliente)}</p>
            <p>Nome: ${escaparHtml(clienteEncontrado.nome)}</p>
            <p>CPF: ${escaparHtml(clienteEncontrado.cpf ?? "")}</p>
            <p>Endereço: ${escaparHtml(clienteEncontrado.endereco ?? "")}</p>
            <p>Email: ${escaparHtml(clienteEncontrado.email ?? "")}</p>
            <p>Telefone: ${escaparHtml(clienteEncontrado.telefone ?? "")}</p>
        `;

        // Carrega a página de consulta do cliente.
        const caminhoHtml = path.join(__dirname, "cliente-consulta.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");
        
        // Insere os dados e o código do cliente nos marcadores.
        const paginaPreenchida = paginaHtml
            .replace("<!-- DADOS_CLIENTE -->", () => dadosCliente)
            .replaceAll(
                "<!-- CODIGO_CLIENTE -->",
                () => escaparHtml(clienteEncontrado.id_cliente)
            );

        
        // Envia a página preenchida ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao consultar cliente:", erro.message);

        await enviarMensagem(
            "Erro ao consultar cliente",
            "Não foi possível consultar o cliente.",
            500,
            resposta
        );
    }
}

// Lista os clientes cadastrados no banco de dados.
async function listarClientes(requisicao, resposta) {

    try {

        // Consulta os clientes ordenados pelo nome e código.
        const resultado = await banco.query(
            `SELECT id_cliente, nome, cpf, endereco, telefone, email
             FROM cliente
             ORDER BY nome, id_cliente`
        );

        // Acumula as linhas que serão inseridas na tabela HTML.
        let listaClientes = "";

        // Monta uma mensagem quando não houver clientes cadastrados.
        if (resultado.rows.length === 0) {

            listaClientes = `
                <tr>
                    <td colspan="6">
                        Nenhum cliente encontrado para a pesquisa.
                    </td>
                </tr>
            `;
        }

        // Percorre os clientes retornados pelo banco.
        for (const cliente of resultado.rows) {

            // Monta uma linha HTML para cada cliente.
            listaClientes += `
                <tr>
                    <td>
                        <a href="/clientes/consultar?codigo=${cliente.id_cliente}">
                            ${escaparHtml(cliente.id_cliente)}
                        </a>
                    </td>
                    <td>${escaparHtml(cliente.nome)}</td>
                    <td>${escaparHtml(cliente.cpf ?? "")}</td>
                    <td>${escaparHtml(cliente.endereco ?? "")}</td>
                    <td>${escaparHtml(cliente.telefone ?? "")}</td>
                    <td>${escaparHtml(cliente.email ?? "")}</td>
                </tr>
            `;
        }

        // Carrega a página de listagem de clientes.
        const caminhoHtml = path.join(__dirname, "cliente-listagem.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Substitui o marcador pelas linhas dos clientes.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- LINHAS_CLIENTES -->",
            () => listaClientes
        );

        // Envia a página preenchida ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao listar clientes:", erro.message);

        await enviarMensagem(
            "Erro ao listar clientes",
            "Não foi possível listar os clientes.",
            500,
            resposta
        );
    }
}

// Carrega o formulário de edição de um cliente.
async function mostrarFormularioEdicaoCliente(requisicao, resposta) {

    // Interpreta a URL para acessar o código do cliente.
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Obtém o código enviado pelo navegador.
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Verifica se o código foi informado.
    if (codigoRecebido === "") {

        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do cliente.",
            400,
            resposta
        );
        return;
    }

    // Converte o código para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Verifica se o código é válido para o campo INTEGER.
    if (!Number.isSafeInteger(codigoPesquisado) ||
        codigoPesquisado <= 0 ||
        codigoPesquisado > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }

    try {

        // Consulta os dados do cliente que será editado.
        const resultado = await banco.query(
            `SELECT id_cliente, nome, cpf, endereco, email, telefone
             FROM cliente
             WHERE id_cliente = $1`,
            [codigoPesquisado]
        );

        // Verifica se o cliente existe.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Cliente não encontrado",
                "Nenhum cliente corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém os dados do cliente encontrado.
        const clienteEncontrado = resultado.rows[0];

        // Carrega a página de edição.
        const caminhoHtml = path.join(__dirname, "cliente-editar.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Preenche o formulário com os valores atuais do cliente.
        const paginaPreenchida = paginaHtml
            .replace("<!-- NOME_CLIENTE -->", () => escaparHtml(clienteEncontrado.nome))
            .replace("<!-- CPF_CLIENTE -->", () => escaparHtml(clienteEncontrado.cpf ?? ""))
            .replace("<!-- ENDERECO_CLIENTE -->", () => escaparHtml(clienteEncontrado.endereco ?? ""))
            .replace("<!-- EMAIL_CLIENTE -->", () => escaparHtml(clienteEncontrado.email ?? ""))
            .replace("<!-- TELEFONE_CLIENTE -->", () => escaparHtml(clienteEncontrado.telefone ?? ""))
            .replaceAll(
                "<!-- CODIGO_CLIENTE -->",
                () => escaparHtml(clienteEncontrado.id_cliente)
            );

        // Envia a página de edição ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao abrir edição do cliente:", erro.message);

        await enviarMensagem(
            "Erro ao editar cliente",
            "Não foi possível carregar os dados do cliente.",
            500,
            resposta
        );
    }
}

// Atualiza os dados de um cliente existente.
async function atualizarCliente(requisicao, resposta) {

    // Lê os dados enviados pelo formulário em UTF-8.
    requisicao.setEncoding("utf8");

    // Acumula o conteúdo recebido na requisição.
    let corpo = "";

    for await (const dadosAtualiza of requisicao) {
        corpo += dadosAtualiza;
    }

    // Interpreta os campos enviados pelo formulário.
    const dados = new URLSearchParams(corpo);

    // Obtém e converte o código do cliente.
    const codigoRecebido = (dados.get("codigo") || "").trim();
    const codigocliente = Number(codigoRecebido);

    // Verifica se o código é um inteiro válido.
    if (!Number.isSafeInteger(codigocliente) ||
        codigocliente <= 0 ||
        codigocliente > 2147483647) {

        await enviarMensagem(
            "Código inválido",
            "Informe um código inteiro entre 1 e 2147483647.",
            400,
            resposta
        );
        return;
    }

    // Obtém os campos que serão atualizados.
    const nome = (dados.get("nome") || "").trim();
    const cpf = (dados.get("cpf") || "").trim();
    const endereco = (dados.get("endereco") || "").trim();
    const email = (dados.get("email") || "").trim();
    const telefone = (dados.get("telefone") || "").trim();

    // Verifica se os campos obrigatórios foram preenchidos.
    if (nome === "") {

        await enviarMensagem(
            "Campos obrigatórios",
            "Informe o nome do cliente.",
            400,
            resposta
        );
        return;
    }

    // Remove pontos, traços e espaços do CPF.
    const cpfPadronizado = cpf
        .replaceAll(".", "")
        .replaceAll("-", "")
        .replaceAll(" ", "");

    // Verifica o CPF somente quando ele foi informado.
    if (cpfPadronizado !== "") {

        const cpfValido = validarCpf(cpfPadronizado);

        if (cpfValido === false) {

            await enviarMensagem(
                "CPF inválido",
                "Informe um CPF válido ou deixe o campo vazio.",
                400,
                resposta
            );
            return;
        }
    }

    const cpfBanco = cpfPadronizado === "" ? null : cpfPadronizado;

    try {

        // Carrega a página de confirmação da atualização do cliente.
        const caminhoHtml = path.join(__dirname, "cliente-atualizacao-sucesso.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Atualiza o cliente identificado pelo código.
        const resultado = await banco.query(
            `UPDATE cliente
             SET nome = $1,
                 cpf = $2,
                 endereco = $3,
                 email = $4,
                 telefone = $5
             WHERE id_cliente = $6
             RETURNING id_cliente`,
            [nome, cpfBanco, endereco, email, telefone, codigocliente]
        );

        // Verifica se algum registro foi atualizado.
        if (resultado.rows.length === 0) {

            await enviarMensagem(
                "Cliente não encontrado",
                "Nenhum cliente corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém o código do cliente atualizado.
        const codigoAtualizado = resultado.rows[0].id_cliente;

        // Monta a confirmação com um link para consultar o cliente.
        const dadosAtualizacao = `
            <p>Código do cliente: ${escaparHtml(codigoAtualizado)}</p>
            <p>
                <a href="/clientes/consultar?codigo=${codigoAtualizado}">
                    Consultar cliente atualizado
                </a>
            </p>
        `;

        // Insere os dados da atualização na página de confirmação.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- DADOS_ATUALIZADO -->",
            () => dadosAtualizacao
        );

        // Retorna HTTP 200 informando que a atualização foi realizada.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Trata combinações duplicadas de cpf.
        if (erro.code === "23505") {

            await enviarMensagem(
                "Cliente duplicado",
                "Já existe um cliente com esse CPF.",
                409,
                resposta
            );
            return;
        }

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao atualizar cliente:", erro.message);

        await enviarMensagem(
            "Erro ao atualizar cliente",
            "Não foi possível atualizar o cliente.",
            500,
            resposta
        );
        return;
    }
}

async function mostrarFormularioEntradaEstoque(requisicao, resposta) {
    try {
        // Consulta os produtos cadastrados no banco.
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
            FROM produto
            ORDER BY id_produto, modelo, tamanho, cor`
        );
        
        // Acumula as opções de produtos para o HTML.
        let listaProdutos = "";

        if (resultado.rows.length === 0) {

            listaProdutos = `
                <option value="" disabled>
                    Nenhum produto cadastrado
                </option>
            `;
        }

        // Percorre os produtos retornados pelo banco.
        for (const produto of resultado.rows) {

            // Monta as opções com os dados utilizados pelos filtros.
            listaProdutos += `
                <option value="${escaparHtml(produto.id_produto)}"
                        data-estoque="${escaparHtml(produto.quantidade)}"
                        data-tamanho="${escaparHtml(produto.tamanho)}"
                        data-cor="${escaparHtml(produto.cor)}">
                    ${escaparHtml(produto.id_produto)} -
                    ${escaparHtml(produto.modelo)} -
                    ${escaparHtml(produto.tamanho)} -
                    ${escaparHtml(produto.cor)}
                </option>
            `;
        }

        // Acumula as opções de tamanho para o filtro.
        let opcoesTamanho = "";

        // Percorre os tamanhos permitidos.
        for (const tamanho of tamanhosPermitidos) {

            // Monta uma opção para cada tamanho.
            opcoesTamanho += `
                <option value="${escaparHtml(tamanho)}">
                    ${escaparHtml(tamanho)}
                </option>
            `;
        }

        // Busca as cores cadastradas, sem repetições.
        const resultadoCores = await banco.query(`
            SELECT DISTINCT cor
            FROM produto
            WHERE cor IS NOT NULL
            ORDER BY cor
        `);

        // Acumula as opções de cor para o filtro.
        let opcoesCor = "";

        // Percorre as cores cadastradas.
        for (const cor of resultadoCores.rows) {

            // Monta uma opção para cada cor.
            opcoesCor += `
                <option value="${escaparHtml(cor.cor)}">
                    ${escaparHtml(cor.cor)}
                </option>
            `;
        }
        
        // Carrega a página de listagem de clientes.
        const caminhoHtml = path.join(__dirname, "entrada-estoque.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Preenche as opções de produtos, tamanhos e cores no formulário.
        const paginaPreenchida = paginaHtml
            .replace("<!-- OPCOES_PRODUTOS -->",        () => listaProdutos)
            .replace("<!-- OPCOES_TAMANHO_ESTOQUE -->", () => opcoesTamanho)
            .replace("<!-- OPCOES_COR_ESTOQUE -->",     () => opcoesCor);

        // Retorna HTTP 200 com o formulário preenchido.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao preencher formulário de entrada de estoque:", erro.message);

        await enviarMensagem(
            "Erro ao preencher formulário de entrada de estoque",
            "Não foi possível preencher o formulário de entrada de estoque.",
            500,
            resposta
        );
        return;
    }
}

 // Registra a entrada de estoque de um produto.
async function atualizarEntradaEstoque(requisicao, resposta) {

    // Guarda a conexão do PostgreSQL.
    let conexao;

    // Indica se existe uma transação em andamento.
    let transacaoAberta = false;

    // Indica se a conexão deverá ser descartada.
    let descartarConexao = false;

    // Indica se o COMMIT foi iniciado.
    let commitIniciado = false;

    // Indica se a gravação foi confirmada.
    let gravacaoConfirmada = false;

    try {

        // Lê os dados enviados pelo formulário em UTF-8.
        requisicao.setEncoding("utf8");

        // Acumula o conteúdo recebido na requisição.
        let corpo = "";

        for await (const dadosAtualiza of requisicao) {
            corpo += dadosAtualiza;
        }

        // Interpreta os campos enviados pelo formulário.
        const dados = new URLSearchParams(corpo);

        // Recupera os valores informados pelo usuário.
        const codigoRecebido = (dados.get("codigo") || "").trim();
        const quantidadeRecebida = (dados.get("quantidade") || "").trim();
        const observacao = (dados.get("observacao") || "").trim();

        // Converte o código para número.
        const codigoProduto = Number(codigoRecebido);

        // Valida o código do produto.
        if (
            codigoRecebido === "" ||
            !Number.isSafeInteger(codigoProduto) ||
            codigoProduto <= 0 ||
            codigoProduto > 2147483647
        ) {

            await enviarMensagem(
                "Código inválido",
                "Informe um código inteiro entre 1 e 2147483647.",
                400,
                resposta
            );
            return;
        }

        // Converte a quantidade para número.
        const quantidadeEntrada = Number(quantidadeRecebida);

        // Valida a quantidade informada.
        if (
            quantidadeRecebida === "" ||
            !Number.isSafeInteger(quantidadeEntrada) ||
            quantidadeEntrada <= 0 ||
            quantidadeEntrada > 2147483647
        ) {

            await enviarMensagem(
                "Quantidade inválida",
                "Informe uma quantidade inteira entre 1 e 2147483647.",
                400,
                resposta
            );
            return;
        }

        // Carrega o HTML antes de iniciar a transação.
        const caminhoHtml = path.join(
            __dirname,
            "entrada-estoque-sucesso.html"
        );

        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Reserva uma conexão do Pool.
        conexao = await banco.connect();

        // Inicia a transação.
        await conexao.query("BEGIN");

        // Informa que existe uma transação aberta.
        transacaoAberta = true;

        // Consulta o produto dentro da mesma transação.
        const resultadoConsulta = await conexao.query(
            `SELECT id_produto
             FROM produto
             WHERE id_produto = $1`,
            [codigoProduto]
        );

        // Verifica se o produto existe.
        if (resultadoConsulta.rows.length === 0) {

            // Encerra a transação sem alterações.
            await conexao.query("ROLLBACK");
            transacaoAberta = false;

            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );
            return;
        }

        // Obtém o código do produto consultado.
        const codigoProdutoConsultado =
            resultadoConsulta.rows[0].id_produto;

        // Atualiza o saldo, respeitando o limite do INTEGER.
        const resultadoUpdate = await conexao.query(
            `UPDATE produto
             SET quantidade = quantidade + $1
             WHERE id_produto = $2
               AND quantidade <= 2147483647 - $1
             RETURNING id_produto, quantidade`,
            [quantidadeEntrada, codigoProdutoConsultado]
        );

        // Verifica se o UPDATE conseguiu alterar o produto.
        if (resultadoUpdate.rows.length === 0) {

            // Encerra a transação sem confirmar a entrada.
            await conexao.query("ROLLBACK");
            transacaoAberta = false;

            await enviarMensagem(
                "Entrada não realizada",
                "O produto não pôde ser atualizado. Verifique se existe e se a quantidade ultrapassa o limite do estoque.",
                400,
                resposta
            );
            return;
        }

        // Recupera os valores retornados pelo UPDATE.
        const codigoAtualizado = resultadoUpdate.rows[0].id_produto;
        const estoqueAtualizado = resultadoUpdate.rows[0].quantidade;

        // Registra o histórico da entrada de estoque.
        await conexao.query(
            `INSERT INTO movimentacao_estoque
                (id_produto, tipo, quantidade, observacao)
             VALUES
                ($1, 'E', $2, $3)`,
            [
                codigoAtualizado,
                quantidadeEntrada,
                observacao || null
            ]
        );

        // Indica que vamos tentar confirmar a transação.
        commitIniciado = true;

        // Confirma o UPDATE e o INSERT juntos.
        await conexao.query("COMMIT");

        // Marca a transação como encerrada e confirmada.
        transacaoAberta = false;
        gravacaoConfirmada = true;

        // Monta os dados exibidos na confirmação.
        const dadosAtualizacao = `
            <p>Código do produto: ${escaparHtml(codigoAtualizado)}</p>
            <p>Quantidade de entrada: ${escaparHtml(quantidadeEntrada)}</p>
            <p>Estoque atualizado: ${escaparHtml(estoqueAtualizado)}</p>
            <p>
                <a href="/produtos/consultar?codigo=${codigoAtualizado}">
                    Consultar produto atualizado
                </a>
            </p>
        `;

        // Substitui o marcador pelos dados atualizados.
        const paginaPreenchida = paginaHtml.replace(
            "<!-- DADOS_ATUALIZADO -->",
            () => dadosAtualizacao
        );

        // Envia a confirmação ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra o erro original no terminal.
        console.error("Erro ao registrar entrada de estoque:", erro);

        // Se o COMMIT começou, não sabemos necessariamente
        // se a gravação foi confirmada quando ocorre uma falha.
        if (commitIniciado && !gravacaoConfirmada) {

            // Evita reutilizar uma conexão em estado incerto.
            descartarConexao = true;
        }

        // Tenta desfazer a transação que ainda estiver aberta.
        if (conexao && transacaoAberta && !gravacaoConfirmada) {

            try {

                await conexao.query("ROLLBACK");

                // O ROLLBACK foi executado.
                transacaoAberta = false;

            } catch (erroRollback) {

                // Não reutiliza a conexão se o ROLLBACK falhar.
                descartarConexao = true;

                console.error(
                    "Erro ao desfazer transação:",
                    erroRollback.message
                );
            }
        }

        // Se a resposta já começou, não envia outra página HTTP.
        if (resposta.headersSent) {

            // Finaliza a resposta somente se ainda estiver aberta.
            if (!resposta.writableEnded) {
                resposta.end();
            }

            return;
        }

        // Se houve falha durante o COMMIT, o resultado pode ser incerto.
        if (commitIniciado && !gravacaoConfirmada) {

            await enviarMensagem(
                "Não foi possível confirmar o resultado",
                "Verifique o saldo e o histórico do produto antes de tentar novamente.",
                500,
                resposta
            );

        } else if (gravacaoConfirmada) {

            // O banco confirmou a operação, mas ocorreu
            // algum erro posterior, como na resposta HTML.
            await enviarMensagem(
                "Entrada registrada",
                "A entrada foi gravada, mas ocorreu um problema ao apresentar a confirmação.",
                500,
                resposta
            );

        } else {

            // Erro antes da confirmação da transação.
            await enviarMensagem(
                "Erro ao atualizar estoque",
                "Não foi possível concluir a operação.",
                500,
                resposta
            );
        }

    } finally {

        // Devolve a conexão ao Pool ou a descarta,
        // caso tenha ocorrido uma falha que impeça sua reutilização.
        if (conexao) {
            conexao.release(descartarConexao);
        }
    }
}

// Valida o formato e os dígitos verificadores de um CPF.
function validarCpf(cpf) {

    // Verifica se o CPF contém exatamente 11 dígitos numéricos.
    const formatoCorreto = /^[0-9]{11}$/.test(cpf);

    if (formatoCorreto === false) {
        return false;
    }

    // Recusa CPFs com todos os dígitos iguais.
    if (cpf === cpf[0].repeat(11)) {
        return false;
    }

    // Calcula os dois dígitos verificadores do CPF.
    for (let posicao = 9; posicao <= 10; posicao++) {

        let soma = 0;

        // Multiplica cada dígito pelo peso correspondente.
        for (let indice = 0; indice < posicao; indice++) {
            soma += Number(cpf[indice]) * (posicao + 1 - indice);
        }

        // Obtém o resto da divisão e determina o dígito esperado.
        const resto = soma % 11;
        const digitoEsperado = resto < 2 ? 0 : 11 - resto;

        // Compara o dígito calculado com o CPF informado.
        if (Number(cpf[posicao]) !== digitoEsperado) {
            return false;
        }
    }

    // Retorna verdadeiro quando todas as verificações passaram.
    return true;
}


// Lê uma página HTML e envia seu conteúdo ao navegador.
async function enviarPaginaHtml(nomeArquivo, resposta) {

    try {

        // Monta o caminho completo do arquivo HTML.
        const caminhoHtml = path.join(__dirname, nomeArquivo);

        // Lê o conteúdo do arquivo utilizando UTF-8.
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Acumula as opções de tamanho utilizadas nos formulários.
        let opcoesTamanho = "";

        for (const tamanho of tamanhosPermitidos) {

            opcoesTamanho += `
                <option value="${escaparHtml(tamanho)}">
                    ${escaparHtml(tamanho)}
                </option>
            `;
        }

        // Preenche os marcadores de tamanho existentes na página.
        const paginaPreenchida = paginaHtml
            .replace(
                "<!-- OPCOES_TAMANHO_CADASTRO -->",
                () => opcoesTamanho
            )
            .replace(
                "<!-- OPCOES_TAMANHO_FILTRO -->",
                () => opcoesTamanho
            );

        // Envia a página HTML ao navegador.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra o arquivo que apresentou problema.
        console.error("Erro ao carregar " + nomeArquivo + ":", erro.message);

        await enviarMensagem(
            "Erro ao carregar a página",
            "Não foi possível carregar a página.",
            500,
            resposta
        );
    }
}


// Converte caracteres especiais para evitar interpretação como código HTML.
function escaparHtml(valor) {

    // Converte o valor para texto e substitui caracteres especiais.
    return String(valor)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}


// Monta e envia uma página de mensagem ao navegador.
async function enviarMensagem(titulo, texto, status, resposta) {

    try {

        // Carrega a página padrão utilizada para mensagens.
        const caminhoHtml = path.join(__dirname, "mensagem.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Substitui os marcadores pelos textos recebidos.
        const paginaPreenchida = paginaHtml
            .replace(
                "<!-- TITULO_MENSAGEM -->",
                () => escaparHtml(titulo)
            )
            .replace(
                "<!-- TEXTO_MENSAGEM -->",
                () => escaparHtml(texto)
            );

        // Envia a mensagem utilizando o status HTTP informado.
        resposta.writeHead(status, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        // Registra o erro ocorrido durante o carregamento.
        console.error("Erro ao carregar a mensagem:", erro.message);

        // Envia texto simples caso a página HTML não esteja disponível.
        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível carregar a página de mensagem.");
    }
}

async function listarMovimentacoesEstoque(requisicao, resposta) {

    try {
        // Interpreta a URL para acessar seus parâmetros.
        const endereco = new URL(requisicao.url, "http://localhost:3000");

        // Obtém o código informado e remove espaços das extremidades.
        const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

        // Obtém e padroniza o tipo da movimentacao.
        const tipoRecebido = (endereco.searchParams.get("tipo") || "").trim().toUpperCase();    

        if (tipoRecebido !== "" && tipoRecebido !== "E" && tipoRecebido !== "S") {
            await enviarMensagem(
                "Tipo inválido",
                "Informe um tipo válido (E para Entrada ou S para Saída).",
                400,
                resposta
            );
            return;
        }

        // Código opcional para filtrar as movimentacoes.
        let codigoPesquisado = null;

        if (codigoRecebido !== "") {

            // Converte o código recebido para número.
            codigoPesquisado = Number(codigoRecebido);

            // Verifica se o código é um inteiro positivo dentro do limite do PostgreSQL.
            if (!Number.isSafeInteger(codigoPesquisado) ||
                codigoPesquisado <= 0 ||
                codigoPesquisado > 2147483647) {

                await enviarMensagem(
                    "Código inválido",
                    "Informe um código inteiro entre 1 e 2147483647.",
                    400,
                    resposta
                );
                return;
            }
        }
        
        const movimentacoes = await banco.query(
            `SELECT
                produto.id_produto,
                produto.modelo,
                movimentacao_estoque.tipo,
                movimentacao_estoque.quantidade,
                movimentacao_estoque.data_movimentacao,
                movimentacao_estoque.observacao
            FROM movimentacao_estoque
            INNER JOIN produto
                ON produto.id_produto = movimentacao_estoque.id_produto
            WHERE ($1::INTEGER IS NULL OR produto.id_produto = $1)
            AND ($2 = '' OR movimentacao_estoque.tipo = $2)
            ORDER BY movimentacao_estoque.data_movimentacao DESC,
                     movimentacao_estoque.id_movimentacao DESC`,
            [codigoPesquisado, tipoRecebido]
        );

        let listaMovtoEstoque = "";

        // Monta uma mensagem quando nenhuma movimentação for encontrada.
        if (movimentacoes.rows.length === 0) {

            listaMovtoEstoque = `
                <tr>
                    <td colspan="6">
                        Nenhuma movimentação encontrada para a pesquisa.
                    </td>
                </tr>
            `;
        }

        // Percorre as movimentacoes retornadas pelo banco.
        for (const movimentacao_estoque of movimentacoes.rows) {

            // Formata a data e hora da movimentacao.
            const dataFormatada = movimentacao_estoque.data_movimentacao.toLocaleString("pt-BR", {
                timeZone: "America/Sao_Paulo"
            });
            
            let tipoDescricao = "";

            if (movimentacao_estoque.tipo === "E") {
                tipoDescricao = "Entrada";
            } else {
                tipoDescricao = "Saída";
            }
            
            // Monta uma linha da tabela para cada movimentacao.
            listaMovtoEstoque += `
                    
                <tr>
                    <td>${escaparHtml(movimentacao_estoque.id_produto)}</td>
                    <td>${escaparHtml(movimentacao_estoque.modelo)}</td>
                    <td>${escaparHtml(tipoDescricao)}</td>
                    <td>${escaparHtml(dataFormatada)}</td>
                    <td>${escaparHtml(movimentacao_estoque.quantidade)}</td>
                    <td>${escaparHtml(movimentacao_estoque.observacao ?? "")}</td>
                </tr>`;
        }

        const selectedTodas    = tipoRecebido === "";
        const selectedEntradas = tipoRecebido === "E";
        const selectedSaidas   = tipoRecebido === "S";

        // Carrega a estrutura HTML do histórico de movimentações.
        const caminhoHtml = path.join(__dirname, "estoque-movimentacoes.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Substitui o marcador pelas linhas montadas.
        const paginaPreenchida = paginaHtml
            .replace("<!-- LINHAS_MOVIMENTACOES -->", () => listaMovtoEstoque)
            .replace("<!-- CODIGO_PESQUISADO -->",    () => escaparHtml(codigoPesquisado ?? ""))
            .replace("<!-- SELECTED_TODAS -->",       () => selectedTodas ? "selected" : "")
            .replace("<!-- SELECTED_ENTRADAS -->",    () => selectedEntradas ? "selected" : "")
            .replace("<!-- SELECTED_SAIDAS -->",      () => selectedSaidas ? "selected" : "");

        // Envia a página com as movimentações de estoque.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {

        console.error("Erro ao listar movimentações:", erro);

        await enviarMensagem(
            "Erro",
            "Não foi possível consultar as movimentações de estoque.",
            500,
            resposta
        );
    }
}



//Fim das funções do servidor HTTP

//Inicio da rota do servidor HTTP
// Cria o servidor HTTP para atender às requisições do navegador.
const servidor = http.createServer(async (requisicao, resposta) => {

    // Obtém a URL da requisição.
    const url = new URL(requisicao.url, "http://localhost:3000");

    // Obtém o caminho da URL sem os parâmetros.
    const caminho = url.pathname;

    // Obtém o método HTTP utilizado.
    const metodo = requisicao.method;

    // Exibe no terminal os dados da requisição.
    console.log("Método:", metodo, "| Caminho:", requisicao.url);

    // Abre a página inicial.
    if (caminho === "/" && metodo === "GET") {

        await enviarPaginaHtml("index.html", resposta);
        return;

    // Cadastra um novo produto.
    } else if (caminho === "/produtos/cadastrar" && metodo === "POST") {

        await cadastrarProduto(requisicao, resposta);
        return;

    // Consulta um produto pelo código.
    } else if (caminho === "/produtos/consultar" && metodo === "GET") {

        await consultarProduto(requisicao, resposta);
        return;

    // Lista os produtos cadastrados, aplicando os filtros.
    } else if (caminho === "/produtos" && metodo === "GET") {

        await listarProdutos(requisicao, resposta);
        return;

    // Abre o formulário de edição do produto.
    } else if (caminho === "/produtos/editar" && metodo === "GET") {

        await mostrarFormularioEdicaoProduto(requisicao, resposta);
        return;

    // Atualiza os dados de um produto.
    } else if (caminho === "/produtos/atualizar" && metodo === "POST") {

        await atualizarProduto(requisicao, resposta);
        return;

    // Abre o formulário de cadastro de clientes.
    } else if (caminho === "/clientes/novo" && metodo === "GET") {

        await enviarPaginaHtml("cliente-cadastro.html", resposta);
        return;

    // Cadastra um novo cliente.
    } else if (caminho === "/clientes/cadastrar" && metodo === "POST") {

        await cadastrarCliente(requisicao, resposta);
        return;

    // Consulta um cliente pelo código.
    } else if (caminho === "/clientes/consultar" && metodo === "GET") {

        await consultarCliente(requisicao, resposta);
        return;

    // Lista os clientes cadastrados.
    } else if (caminho === "/clientes" && metodo === "GET") {

        await listarClientes(requisicao, resposta);
        return;

    // Abre o formulário de edição do cliente.
    } else if (caminho === "/clientes/editar" && metodo === "GET") {

        await mostrarFormularioEdicaoCliente(requisicao, resposta);
        return;

    // Abre o formulário de atualização do cliente.
    } else if (caminho === "/clientes/atualizar" && metodo === "POST") {

        await atualizarCliente(requisicao, resposta);
        return;

    // Abre o formulário de entrada de estoque com os produtos cadastrados.
    } else if (caminho === "/estoque/novo" && metodo === "GET") {

        await mostrarFormularioEntradaEstoque(requisicao, resposta);
        return;

        // Abre o formulário de atualização de entrada de estoque.
    } else if (caminho === "/estoque/atualizar" && metodo === "POST") {

        await atualizarEntradaEstoque(requisicao, resposta);
        return;

    } else if (caminho === "/estoque/movimentacoes" && metodo === "GET") {
        
        await listarMovimentacoesEstoque(requisicao, resposta);
        return;

    // Abre a página Sobre.
    } else if (caminho === "/sobre" && metodo === "GET") {

        await enviarPaginaHtml("sobre.html", resposta);
        return;

    // Retorna uma mensagem quando o endereço solicitado não existe.
    } else {

        await enviarMensagem(
            "Página não encontrada",
            "O endereço informado não existe no sistema.",
            404,
            resposta
        );
        return;
    }
});

//Fim da rota do servidor HTTP

// Inicia o servidor HTTP na porta 3000.
servidor.listen(3000, () => {
    console.log("Servidor iniciado em http://localhost:3000");
});
