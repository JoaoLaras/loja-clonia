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

//function cadastrarProduto
// Receberá o processamento do cadastro de um produto por código.
async function cadastrarProduto(requisicao, resposta) {
// Lê os dados recebidos como texto UTF-8.
    requisicao.setEncoding("utf8");

    // Começa vazio e acumula o conteúdo enviado pelo navegador.
    let corpo = "";

    // Percorre as partes do corpo da requisição.
    // await aguarda cada parte chegar.
    for await (const parteCadastro of requisicao) {
        corpo += parteCadastro;
    }

    // Interpreta os campos enviados pelo formulário.
    const dados = new URLSearchParams(corpo);

    // Lê os campos e remove espaços do início e do fim.
    const modelo = (dados.get("modelo") || "").trim();
    const tamanho = (dados.get("tamanho") || "").trim();
    const cor = (dados.get("cor") || "").trim();

    // Rejeita o pedido se qualquer campo estiver vazio.
    // || significa OU: basta uma condição ser verdadeira.
    if (modelo === "" || tamanho === "" || cor === "") {
        
        await enviarMensagem(
            "Campos obrigatórios",
            "Informe modelo, tamanho e cor.",
            400,
            resposta
        );

        // Encerra este atendimento para não enviar outra resposta.
        return;
    }

    // Converte o tamanho para maiúsculas.
    // Assim, "g" vira "G"; "54" permanece "54".
    const tamanhoPadronizado = tamanho.toUpperCase();

    // Lista dos tamanhos permitidos no cadastro.
    const tamanhosPermitidos = [
        "P", "M", "G", "GG",
        "40", "42", "44", "46", "48", "50", "52", "54"
    ];

    // includes() retorna true se o tamanho estiver na lista.
    // ! inverte o resultado: entramos se NÃO estiver na lista.
    if (!tamanhosPermitidos.includes(tamanhoPadronizado)) {

        await enviarMensagem(
            "Tamanho inválido",
            "Use P, M, G, GG ou " +
            "40, 42, 44, 46, 48, 50, 52, 54.",
            400,
            resposta
        );
        // Interrompe o atendimento após informar o problema.
        return;
    }

    try {

        // Localiza e lê a página de confirmação.
        const caminhoHtml = path.join(__dirname, "cadastro-sucesso.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Cria o produto com estoque inicial zero.
        // O banco gera o id_produto automaticamente.
        // $1, $2 e $3 recebem os valores do array abaixo.
        const resultado = await banco.query(
            `INSERT INTO produto (modelo, tamanho, cor, quantidade)
                VALUES ($1, $2, $3, 0)
                RETURNING id_produto`,
            [modelo, tamanhoPadronizado, cor]
        );

        // RETURNING devolve o código gerado pelo banco.
        const codigoCriado = resultado.rows[0].id_produto;

        // Monta o conteúdo que aparecerá na página de confirmação.
        // Mostra o código criado e um link para consultar esse produto.
        const dadosCadastro = `
            <p>Código do produto: ${escaparHtml(codigoCriado)}</p>

            <p>
                <a href="/buscar?codigo=${codigoCriado}">
                    Consultar produto cadastrado
                </a>
            </p>
        `;

        // Substitui o marcador pelo código gerado no cadastro.
        const paginaPreenchida = paginaHtml.replace("<!-- DADOS_CADASTRO -->", () => dadosCadastro
        );

        // 201 indica que o produto foi criado.
        // Agora enviamos uma página HTML.
        resposta.writeHead(201, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {
        // 23505 indica violação de uma regra UNIQUE.
        // Aqui tratamos a combinação repetida de modelo, tamanho e cor.
        if (erro.code === "23505") {
            
            // Aguarda o envio da página com a mensagem.
            await enviarMensagem(
                "Produto duplicado",
                "Já existe um produto com esse modelo, tamanho e cor.",
                409,
                resposta
            );

            // Encerra cadastrarProduto.
            return;
        }

        // Outros erros ficam detalhados no terminal.
        console.error("Erro ao cadastrar produto:", erro.message);
        
        await enviarMensagem(
            "Erro ao cadastrar produto.",
            "Não foi possível cadastrar o produto.",
            500,
            resposta
        );

        // Interrompe o atendimento após informar o problema.
        return;
 
    }
}

//function buscarProduto
// Receberá o processamento da consulta de um produto por código.
async function buscarProduto(requisicao, resposta) {
// Organiza a URL e lê o código como texto.
    
    // Interpreta "/buscar?codigo=4" usando a base.
    // O endereço completo fica: http://localhost:3000/buscar?codigo=4
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Lê o valor do parâmetro codigo e retorna o texto "4".
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Rejeita campo vazio antes da conversão.
    if (codigoRecebido === "") {
        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do produto.",
            400,
            resposta
        );

        return;
    }

    // Converte o filtro para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Exige um inteiro positivo dentro do limite do INTEGER
    // usado no campo id_produto do PostgreSQL.
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
        // O filtro do formulário é enviado como parâmetro.
        // $1 recebe o primeiro valor do array [codigoPesquisado].
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
                FROM produto
                WHERE id_produto = $1`,
            [codigoPesquisado]
        );

        // Nenhum produto corresponde ao código pesquisado.
        if (resultado.rows.length === 0) {
            // Aguarda o envio da página com a mensagem.
            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );

            // Encerra buscarProduto após enviar a resposta.
            return;
        }

        // Lê o único produto encontrado.
        const produtoEncontrado = resultado.rows[0];

        // Monta os parágrafos com os dados desse produto.
        // <p> representa um parágrafo; não precisamos de <tr> aqui.
        const dadosProduto = `
            <p>Código: ${escaparHtml(produtoEncontrado.id_produto)}</p>
            <p>Modelo: ${escaparHtml(produtoEncontrado.modelo)}</p>
            <p>Tamanho: ${escaparHtml(produtoEncontrado.tamanho)}</p>
            <p>Cor: ${escaparHtml(produtoEncontrado.cor)}</p>
            <p>Quantidade: ${escaparHtml(produtoEncontrado.quantidade)}</p>
        `;

        // Localiza e lê o arquivo HTML.
        const caminhoHtml = path.join(__dirname, "produto.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Substitui o marcador pelos dados do produto.
        const paginaPreenchida = paginaHtml
            .replace("<!-- DADOS_PRODUTO -->", () => dadosProduto)
            .replace("<!-- CODIGO_PRODUTO -->",() => escaparHtml(produtoEncontrado.id_produto));

        // Envia a página preenchida como HTML.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {
        // Registra os detalhes técnicos no terminal.
        console.error("Erro ao consultar produto:", erro.message);

        // Envia a página de mensagem ao navegador.
        await enviarMensagem(
            "Erro ao consultar produto",
            "Não foi possível consultar o produto.",
            500,
            resposta
        );
    }
}

//function listarProdutos
// Função que receberá o processamento da listagem de produtos.
async function listarProdutos(requisicao, resposta) {
    // Organiza o endereço para acessar seus parâmetros.
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Obtém o filtro modelo.
    // Se não existir, usa texto vazio; trim() remove espaços das extremidades.
    const modeloFiltro = (endereco.searchParams.get("modelo") || "").trim();
    // Lê a cor enviada na URL.
    // Se não houver cor, usa texto vazio; trim() remove espaços nas extremidades.
    const corFiltro = (endereco.searchParams.get("cor") || "").trim();

    // Lê o tamanho e padroniza: "g" vira "G".
    const tamanhoFiltro = (endereco.searchParams.get("tamanho") || "").trim().toUpperCase();

    try {
        // Busca produtos que correspondam ao modelo E à cor informados.
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
            FROM produto
            WHERE modelo ILIKE $1
            AND cor ILIKE $2
            AND ($3 = '' OR tamanho = $3)
            ORDER BY id_produto`,
            [
                "%" + modeloFiltro + "%", // Valor usado em $1.
                "%" + corFiltro + "%",     // Valor usado em $2.
                      tamanhoFiltro     // Valor usado em $3.
            ]
        );

        // Começa vazio e acumula as linhas da tabela.
        let listaProdutos = "";

        // Se não houver produtos, monta uma linha com a mensagem.
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
            // Cada tr representa uma linha; cada td representa uma célula.
            listaProdutos += `
                <tr>
                    <!-- O código vira um link para a consulta desse produto. -->
                    <td>
                        <a href="/buscar?codigo=${produto.id_produto}">
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

    // Localiza o arquivo que contém a estrutura da página.
    const caminhoHtml = path.join(__dirname, "produtos.html");

    // Lê o HTML como texto.
    const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

    // Insere o texto das linhas exatamente como foi montado.
    const paginaPreenchida = paginaHtml.replace(
        "<!-- LINHAS_PRODUTOS -->",
        () => listaProdutos
    );

    // Informa que a resposta contém HTML.
    resposta.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8"
    });

    // Envia a página com os produtos inseridos na tabela.
    resposta.end(paginaPreenchida);

    } catch (erro) {
        // Registra os detalhes no terminal.
        console.error("Erro ao listar produtos:", erro.message);

        await enviarMensagem(
            "Erro ao listar produtos",
            "Não foi possível listar os produtos.",
            500,
            resposta
        );
    }
}

// Lê uma página HTML e envia seu conteúdo ao navegador.
async function enviarPaginaHtml(nomeArquivo, resposta) {
    try {
        // Monta o caminho do arquivo na pasta do servidor.
        const caminhoHtml = path.join(__dirname, nomeArquivo);

        // Aguarda a leitura do conteúdo em UTF-8.
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Informa que estamos enviando HTML.
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8"
        });

        // Envia a página e encerra a resposta.
        resposta.end(paginaHtml);

    } catch (erro) {
        // Identifica qual arquivo apresentou problema.
        console.error("Erro ao carregar " + nomeArquivo + ":", erro.message);

        await enviarMensagem(
            "Erro ao carregar a página",
            "Não foi possível carregar a página.",
            500,
            resposta
        );
    }
}

// Converte caracteres especiais para exibir um valor como texto no HTML.
function escaparHtml(valor) {
    return String(valor)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// Preenche a página de mensagem e envia a resposta.
async function enviarMensagem(titulo, texto, status, resposta) {
    try {
        const caminhoHtml = path.join(__dirname, "mensagem.html");

        // A leitura pode falhar, por exemplo, se o arquivo não existir.
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Preenche os marcadores com os textos recebidos.
        const paginaPreenchida = paginaHtml
            .replace("<!-- TITULO_MENSAGEM -->", () => escaparHtml(titulo))
            .replace("<!-- TEXTO_MENSAGEM -->", () => escaparHtml(texto));

        resposta.writeHead(status, {
            "Content-Type": "text/html; charset=utf-8"
        });

        resposta.end(paginaPreenchida);

    } catch (erro) {
        // Registra o problema para investigarmos.
        console.error("Erro ao carregar a mensagem:", erro.message);

        // Usa texto simples como alternativa se o HTML falhar.
        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível carregar a página de mensagem.");
    }
}

//function editaProduto
// Receberá o processamento da consulta de um produto por código.
async function editaProduto(requisicao, resposta) {
// Organiza a URL e lê o código como texto.
    
    // Interpreta "/editar?codigo=4" usando a base.
    // O endereço completo fica: http://localhost:3000/editar?codigo=4
    const endereco = new URL(requisicao.url, "http://localhost:3000");

    // Lê o valor do parâmetro codigo e retorna o texto "4".
    const codigoRecebido = (endereco.searchParams.get("codigo") || "").trim();

    // Rejeita campo vazio antes da conversão.
    if (codigoRecebido === "") {
        await enviarMensagem(
            "Código obrigatório",
            "Informe o código do produto.",
            400,
            resposta
        );

        return;
    }

    // Converte o filtro para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Exige um inteiro positivo dentro do limite do INTEGER
    // usado no campo id_produto do PostgreSQL.
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
        // O filtro do formulário é enviado como parâmetro.
        // $1 recebe o primeiro valor do array [codigoPesquisado].
        const resultado = await banco.query(
            `SELECT id_produto, modelo, tamanho, cor, quantidade
                FROM produto
                WHERE id_produto = $1`,
            [codigoPesquisado]
        );

        // Nenhum produto corresponde ao código pesquisado.
        if (resultado.rows.length === 0) {
            // Aguarda o envio da página com a mensagem.
            await enviarMensagem(
                "Produto não encontrado",
                "Nenhum produto corresponde ao código informado.",
                404,
                resposta
            );

            // Encerra buscarProduto após enviar a resposta.
            return;
        }

        // Lê o único produto encontrado.
        const produtoEncontrado = resultado.rows[0];

        // Lê a página que contém o campo de edição.
        const caminhoHtml = path.join(__dirname, "produto-editar.html");
        const paginaHtml = await fs.readFile(caminhoHtml, "utf8");

        // Coloca o modelo encontrado dentro do value do input.
        const paginaPreenchida = paginaHtml.replace("<!-- MODELO_PRODUTO -->",() => escaparHtml(produtoEncontrado.modelo))
                                           .replace("<!-- COR_PRODUTO -->",() => escaparHtml(produtoEncontrado.cor))
                                           .replace("<!-- TAMANHO_PRODUTO -->",() => escaparHtml(produtoEncontrado.tamanho));
        resposta.end(paginaPreenchida);

            } catch (erro) {
                // Registra os detalhes técnicos no terminal.
                console.error("Erro ao consultar produto:", erro.message);

                // Envia a página de mensagem ao navegador.
                await enviarMensagem(
                    "Erro ao consultar produto",
                    "Não foi possível consultar o produto.",
                    500,
                    resposta
                );
            }
        }

// async permite aguardar a consulta com await.
// Esta função atende cada pedido do navegador.
const servidor = http.createServer(async (requisicao, resposta) => {
    
    const caminho = requisicao.url;

    // Mostra o pedido no terminal do servidor.
    console.log("Método:", requisicao.method, "| Caminho:", caminho);

    if (caminho === "/") {

        // Envia a página inicial usando a mesma função.
        await enviarPaginaHtml("index.html", resposta);
        return;  

    } else if (caminho === "/cadastrar" && requisicao.method === "POST") {

        // Executa o processamento do cadastro.
        await cadastrarProduto(requisicao, resposta);
        return;
        
    } else if (requisicao.method === "GET" && (caminho === "/buscar" || caminho.startsWith("/buscar?"))) {

        // Encaminha o processamento para a função.
        await buscarProduto(requisicao, resposta);
        return;

    } else if (requisicao.method === "GET" && (caminho === "/produtos" || caminho.startsWith("/produtos?"))) {
        
        // Executa a função que consulta e responde com os produtos.
        await listarProdutos(requisicao, resposta);
        // Encerra o atendimento desta requisição.
        return;

    } else if (caminho === "/sobre") {
        
        // Envia a página Sobre usando a mesma função.
        await enviarPaginaHtml("sobre.html", resposta);
        return;  
    
    } else if (requisicao.method === "GET" && (caminho === "/editar" || caminho.startsWith("/editar?"))) {

        // Encaminha o processamento para a função.
        await editaProduto(requisicao, resposta);
        return;
        
    } else {
        await enviarMensagem(
            "Página não encontrada",
            "O endereço informado não existe no sistema.",
            404,
            resposta
        );
    }
});

// Inicia o servidor na porta 3000.
servidor.listen(3000, () => {
    console.log("Servidor iniciado em http://localhost:3000");
});