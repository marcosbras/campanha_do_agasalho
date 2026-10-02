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

## Arquivos principais

- `server.js`: servidor, validações, autenticação, rotas e SQL.
- `public/index.html`: estrutura da página e formulários.
- `public/app.js`: interação da página e chamadas para a API.
- `public/styles.css`: estilos da página.
- `compose.yaml` e `Dockerfile`: configuração do container e do volume do banco.

Este projeto é para fins didáticos. Para publicar na internet, use HTTPS e guarde credenciais nos segredos do serviço de hospedagem.