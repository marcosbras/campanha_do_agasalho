
## Arquitetura e padrões de projeto

Este projeto é um **monólito web**: a interface estática e a API fazem parte do mesmo projeto e, localmente, são servidas pela aplicação Express. Os termos **frontend** e **backend** descrevem papéis exercidos por diferentes arquivos dentro do monólito; não são aplicações independentes nem serviços implantados separadamente. No deploy Vercel, a plataforma pode servir os arquivos estáticos separadamente da função que executa a API, mas o código continua sendo mantido como um único projeto.

A organização é simples e adequada a um projeto didático:

- **Separação por responsabilidade:** `public/` contém a apresentação no navegador; `server.js` concentra as rotas HTTP, validações, autenticação e acesso a dados. É uma separação prática entre frontend, API e persistência, mas não uma arquitetura em camadas estrita: a lógica de domínio e as consultas SQL também ficam no servidor.
- **Middleware do Express:** funções como `express.json()`, `express.static()`, `exigirAdministrador`, `salvarDoador` e `tratarErro` formam uma cadeia reutilizável para processar requisições, validar acesso e tratar erros.
- **Padrão Adapter na persistência:** `criarBancoSqlite()` e `criarBancoPostgres()` oferecem uma interface comum (`prepare`, `get`, `all`, `run` e `exec`) para os dois bancos. Assim, as rotas podem usar os drivers SQLite ou PostgreSQL conforme a configuração. A adaptação é parcial: algumas consultas ainda escolhem SQL e parâmetros específicos de cada banco.
- **Frontend sem framework:** `index.html`, `styles.css` e `app.js` compõem uma interface renderizada no navegador com JavaScript nativo. O `app.js` chama a API REST usando `fetch`; Bootstrap e Bootstrap Icons são carregados por CDN.

Não é uma implementação formal de MVC, nem usa uma camada Repository/Service dedicada: rotas, regras de negócio e SQL estão reunidos principalmente em `server.js`.

### Desenho da estrutura

```text
campanha_do_agasalho/
├── public/                         # Papel de frontend: arquivos estáticos
│   ├── index.html                  # Página, formulários e estrutura visual
│   ├── app.js                      # Interações e chamadas à API REST
│   └── styles.css                  # Estilos da interface
├── server.js                       # Papel de backend: Express, API e autenticação
│   └── (middlewares, rotas /api/* e acesso a dados ficam neste arquivo)
├── package.json                    # Dependências e comandos Node.js
├── package-lock.json               # Versões travadas das dependências
├── Dockerfile                      # Imagem do servidor
├── compose.yaml                    # Serviço e volume persistente do Docker
├── .env.example                    # Exemplo de configuração local
├── .env                            # Configuração local (não versionada)
├── data/                           # Banco SQLite local (gerado, não versionado)
└── update_apostila.py              # Utilitário auxiliar; não participa do servidor

Fluxo principal:

Express (server.js) ── entrega public/* ──> Navegador
Navegador (app.js) ── HTTP/JSON /api/* ──> Express ──> SQLite ou PostgreSQL
```

### Arquivos por função

| Arquivo ou pasta | Papel no monólito | Responsabilidade |
| --- | --- | --- |
| `public/index.html` | Frontend | Estrutura da página e formulários |
| `public/styles.css` | Frontend | Aparência e layout |
| `public/app.js` | Frontend | Eventos da interface e requisições à API |
| `server.js` | Backend | Servidor Express, arquivos estáticos, API, validações, autenticação e SQL |
| `package.json` e `package-lock.json` | Compartilhado / configuração | Dependências e comandos do projeto Node.js |
| `Dockerfile` e `compose.yaml` | Infraestrutura | Empacotamento, execução do servidor e persistência em volume |
| `.env.example` | Configuração | Modelo das variáveis de ambiente |
| `update_apostila.py` | Auxiliar | Script independente, fora do fluxo de execução da aplicação |
| `data/` | Dados locais | Arquivo SQLite criado em tempo de execução; a pasta é ignorada pelo Git |

Este projeto é para fins didáticos. Para publicar na internet, use HTTPS e guarde credenciais nos segredos do serviço de hospedagem.


# Conados git básicos


git remote add origin https://github.com/marcosbras/campanha_do_agasalho.git
git branch -M main
git push -u origin main


echo "# campanha_do_agasalho" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/marcosbras/campanha_do_agasalho.git
git push -u origin main


# Verifica para qual git remoto está apontando 
git remote -v

# Remove apontamento remoto
git remote remove origin




# Campanha do Agasalho

Exemplo didático de cadastro de doadores com Node.js, Express, SQLite, HTML, CSS, Bootstrap e Docker.

## Como funciona

- Qualquer pessoa pode fazer uma inscrição e recebe uma mensagem de agradecimento.
- Apenas administradores conectados podem consultar, editar ou excluir cadastros.
- Um administrador pode criar outras contas, alterar usuários e senhas ou remover contas.
- As senhas são salvas no banco como hash, não como texto aberto.
- Na primeira execução, a conta inicial é criada pelas variáveis `ADMINISTRADOR_INICIAL` e `SENHA_INICIAL`.
- Os dados são guardados nas tabelas `doadores` e `administradores`.

## Pré-requisitos

Para executar localmente, instale o Node.js 22 ou superior. Confira no PowerShell:

```powershell
node --version
npm --version
```

Para executar com Docker, instale o Docker Desktop, abra-o e espere o mecanismo Docker iniciar. Confira:

```powershell
docker --version
docker compose version
```

## Executar localmente

Abra o PowerShell na pasta do projeto e instale as dependências:

```powershell
npm install
```

Defina o administrador criado na primeira execução e inicie o servidor:

```powershell
$env:ADMINISTRADOR_INICIAL = 'professor'
$env:SENHA_INICIAL = 'minha-senha-com-8-caracteres'
npm start
```

Deixe essa janela aberta e acesse [http://localhost:3000](http://localhost:3000). Clique em **Área administrativa** e use o usuário e a senha informados acima.

Por padrão, o SQLite será criado em `data/doadores.sqlite`. Para escolher outra porta ou caminho antes de executar `npm start`:

```powershell
$env:PORTA = '3001'
$env:CAMINHO_BANCO = './data/aula.sqlite'
```

Para encerrar o servidor, volte ao PowerShell e pressione `Ctrl+C`. Ao iniciar novamente com o mesmo banco, os usuários e as senhas do ambiente não são reaplicados: as contas existentes são mantidas.

## Executar com Docker

1. Inicie o Docker Desktop e aguarde o mecanismo ficar disponível.
2. Crie o arquivo `.env` a partir do exemplo:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Abra `.env` e altere `ADMINISTRADOR_INICIAL` e `SENHA_INICIAL`. A senha precisa ter pelo menos 8 caracteres. O valor do exemplo é apenas para aula; escolha outro antes de usar.
4. Construa a imagem e inicie o container:

   ```powershell
   docker compose up --build
   ```

5. Acesse [http://localhost:3000](http://localhost:3000) e entre com a conta definida em `.env`.

Mantenha o terminal aberto para acompanhar as mensagens do servidor. Para parar, pressione `Ctrl+C` e execute:

```powershell
docker compose down
```

O banco fica no volume Docker `dados_doadores`, então os dados continuam lá depois que o container é parado. Para apagar o volume e todos os dados da aula:

```powershell
docker compose down --volumes
```

O arquivo `.env` configura a conta inicial tanto no Docker Compose quanto na execução local. No modo local, as variáveis já definidas no ambiente do PowerShell têm prioridade sobre os valores do arquivo.

## Deploy na Vercel

O projeto exporta o aplicativo Express em `server.js`, um dos entrypoints reconhecidos pela Vercel. A plataforma executa o backend como uma Vercel Function e publica os arquivos de `public/` como assets estáticos. O `express.static()` continua atendendo os arquivos na execução local.

1. Envie o repositório para o GitHub e importe-o na Vercel, usando a pasta raiz do projeto.
2. Selecione Node.js 22. Não configure comando de build nem diretório de saída: este projeto não possui etapa de compilação.
3. Crie ou conecte um PostgreSQL hospedado e configure estas variáveis em **Settings → Environment Variables**:

   - `DATABASE_URL`: URL de conexão do PostgreSQL.
   - `ADMINISTRADOR_INICIAL`: usuário da conta inicial.
   - `SENHA_INICIAL`: senha forte com pelo menos 8 caracteres.

4. Marque as variáveis para os ambientes desejados e faça o deploy. A aplicação cria as tabelas e o primeiro administrador quando o banco ainda não contém administradores. Alterar essas variáveis depois não troca a conta existente.
5. Teste a página, os assets, o cadastro, o login, as operações administrativas e o logout na URL de preview antes de associar o domínio.
6. Para usar domínio próprio, abra **Settings → Domains** no projeto e configure no provedor de DNS os registros indicados pela Vercel.

Não publique o arquivo `.env` nem coloque credenciais no repositório. No deploy, use as variáveis configuradas na Vercel. A persistência do banco e das sessões usa o PostgreSQL; o SQLite serve para desenvolvimento local.

## API

Inscrição pública:

- `POST /api/doadores` cadastra um doador. Campos obrigatórios: `nome`, `email`, `telefone`, `cidade` e `tamanho`; `observacao` é opcional.

Rotas que exigem login de administrador:

- `GET /api/doadores?busca=texto` lista e pesquisa doadores.
- `PUT /api/doadores/:id` atualiza um cadastro.
- `DELETE /api/doadores/:id` remove um cadastro.
- `GET /api/administradores` lista administradores.
- `POST /api/administradores` cria uma conta com `usuario` e `senha`.
- `PUT /api/administradores/:id` altera o usuário e, se preenchida, a senha.
- `DELETE /api/administradores/:id` remove outra conta, mas não permite remover a própria conta conectada ou o último administrador.

Autenticação: `POST /api/entrar`, `POST /api/sair` e `GET /api/sessao`.

