//Ligar banco e servidor node --env-file=.env servidor.js
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
// Receberá o processamento da consulta de um produto por código.
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
        resposta.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Informe modelo, tamanho e cor.");

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
        resposta.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end(
            "Tamanho inválido. Use P, M, G, GG ou " +
            "40, 42, 44, 46, 48, 50, 52, 54."
        );

        // Interrompe o atendimento após informar o problema.
        return;
    }

    try {
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

        // Mostra no terminal qual produto foi cadastrado.
        console.log("Produto cadastrado. Código:", codigoCriado);

        // 201 informa que um novo registro foi criado.
        resposta.writeHead(201, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end(
            `Produto cadastrado com sucesso. Código: ${codigoCriado}`
        );

    } catch (erro) {
        // 23505 indica violação de uma regra UNIQUE.
        // Aqui tratamos a combinação repetida de modelo, tamanho e cor.
        if (erro.code === "23505") {
            resposta.writeHead(409, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            resposta.end(
                "Já existe um produto com esse modelo, tamanho e cor."
            );
            return;
        }

        // Outros erros ficam detalhados no terminal.
        console.error("Erro ao cadastrar produto:", erro.message);

        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível cadastrar o produto.");
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
    const codigoRecebido = endereco.searchParams.get("codigo");

    // Rejeita campo vazio antes da conversão.
    if (codigoRecebido === "") {
        resposta.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Informe o código do produto.");
        return;
    }

    // Converte o filtro para número.
    const codigoPesquisado = Number(codigoRecebido);

    // Exige um inteiro positivo dentro do limite do INTEGER
    // usado no campo id_produto do PostgreSQL.
    if (
        !Number.isSafeInteger(codigoPesquisado) ||
        codigoPesquisado <= 0 ||
        codigoPesquisado > 2147483647
    ) {
        resposta.writeHead(400, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Informe um código inteiro entre 1 e 2147483647.");
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

        // Nenhum registro corresponde ao código pesquisado.
        if (resultado.rows.length === 0) {
            resposta.writeHead(404, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            resposta.end("Produto não encontrado.");
            return;
        }

        // Lê o primeiro registro retornado.
        // A chave primária garante no máximo um produto porNenhum produto encontrado para a pesquisa. código.
        const produtoEncontrado = resultado.rows[0];

        resposta.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        // Os nomes das propriedades são os nomes das colunas SQL.
        resposta.end(
            `Código: ${produtoEncontrado.id_produto}\n` +
            `Modelo: ${produtoEncontrado.modelo}\n` +
            `Tamanho: ${produtoEncontrado.tamanho}\n` +
            `Cor: ${produtoEncontrado.cor}\n` +
            `Quantidade: ${produtoEncontrado.quantidade}`
        );

    } catch (erro) {
        // Detalhes técnicos ficam no terminal para investigarmos.
        console.error("Erro ao consultar produto:", erro.message);

        // 500 informa que ocorreu uma falha no processamento.
        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível consultar o produto.");
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
            ORDER BY modelo, id_produto`,
            [
                "%" + modeloFiltro + "%", // Valor usado em $1.
                "%" + corFiltro + "%",     // Valor usado em $2.
                      tamanhoFiltro     // Valor usado em $3.
            ]
        );

        // Verifica se a consulta retornou uma lista vazia.
        if (resultado.rows.length === 0) {
            resposta.writeHead(200, {
                "Content-Type": "text/plain; charset=utf-8"
            });

            resposta.end("Nenhum produto encontrado para a pesquisa.");

            // Encerra listarProdutos para não continuar o processamento.
            return;
        }

        // let permite acrescentar texto durante as repetições.
        let listaProdutos = "Produtos cadastrados\n\n";

        // produto recebe um registro da lista por vez.
        for (const produto of resultado.rows) {
            // \n cria uma quebra de linha na resposta em texto.
            listaProdutos +=
                `Código: ${produto.id_produto}\n` +
                `Modelo: ${produto.modelo}\n` +
                `Tamanho: ${produto.tamanho}\n` +
                `Cor: ${produto.cor}\n` +
                `Quantidade: ${produto.quantidade}\n\n`;
        }

        // Envia a lista completa em uma única resposta.
        resposta.writeHead(200, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end(listaProdutos);

    } catch (erro) {
        // Registra os detalhes no terminal.
        console.error("Erro ao listar produtos:", erro.message);

        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível listar os produtos.");
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
        // Identifica no terminal qual arquivo apresentou problema.
        console.error("Erro ao carregar " + nomeArquivo + ":", erro.message);

        resposta.writeHead(500, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Não foi possível carregar a página.");
    }
}

// async permite aguardar a consulta com await.
// Esta função atende cada pedido do navegador.
const servidor = http.createServer(async (requisicao, resposta) => {
    
    const caminho = requisicao.url;

    // Mostra o pedido no terminal do servidor.
    console.log("Método:", requisicao.method, "| Caminho:", caminho);

    if (caminho === "/") {

        // Envia a página Sobre usando a mesma função.
        await enviarPaginaHtml("index.html", resposta);
        return;  

    } else if (caminho === "/cadastrar" && requisicao.method === "POST") {

        // Executa o processamento do cadastro.
        await cadastrarProduto(requisicao, resposta);
        return;
        
    } else if (caminho === "/buscar" || caminho.startsWith("/buscar?")) {

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
 
    } else {
        resposta.writeHead(404, {
            "Content-Type": "text/plain; charset=utf-8"
        });

        resposta.end("Página não encontrada.");
    }
});

// Inicia o servidor na porta 3000.
servidor.listen(3000, () => {
    console.log("Servidor iniciado em http://localhost:3000");
});