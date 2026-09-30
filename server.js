// Os módulos node:* já vêm com o Node.js; Express e better-sqlite3 são instalados pelo npm.
const caminho = require('node:path');
const fs = require('node:fs');
const criptografia = require('node:crypto');
const express = require('express');
const BancoSQLite = require('better-sqlite3');

const aplicativo = express();
const porta = Number(process.env.PORTA) || 3000;
const caminhoBanco = process.env.CAMINHO_BANCO || caminho.join(__dirname, 'data', 'doadores.sqlite');
// As sessões ficam na memória neste exemplo e expiram quando o servidor reinicia.
const sessoes = new Map();

// Cria a pasta do banco se ainda não existir e abre o arquivo SQLite.
fs.mkdirSync(caminho.dirname(caminhoBanco), { recursive: true });
const banco = new BancoSQLite(caminhoBanco);
// WAL permite que leituras e gravações ocorram melhor quando há acessos simultâneos.
banco.pragma('journal_mode = WAL');
// Cada tabela guarda um tipo de informação. IF NOT EXISTS preserva os dados ao reiniciar.
banco.exec(`
  CREATE TABLE IF NOT EXISTS doadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    telefone TEXT NOT NULL,
    cidade TEXT NOT NULL,
    tamanho TEXT NOT NULL,
    observacao TEXT NOT NULL DEFAULT '',
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS administradores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

// Copia os cadastros de uma versão anterior em inglês, sem duplicar os já importados.
const tabelaAntigaExiste = banco.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'donors'").get();
if (tabelaAntigaExiste) {
  banco.exec(`
    INSERT OR IGNORE INTO doadores (id, nome, email, telefone, cidade, tamanho, observacao, criado_em, atualizado_em)
    SELECT id, name, email, phone, city, clothing_size, message, created_at, updated_at FROM donors;
  `);
}

// O sal aleatório impede hashes iguais para senhas iguais; a senha original não é salva.
const criarHash = (senha, sal = criptografia.randomBytes(16).toString('hex')) => ({
  sal,
  hash: criptografia.scryptSync(senha, sal, 64).toString('hex')
});

// Na primeira execução, cria a conta inicial usando valores fornecidos fora do código.
if (banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get().quantidade === 0) {
  const usuario = process.env.ADMINISTRADOR_INICIAL;
  const senha = process.env.SENHA_INICIAL;
  if (!usuario || !senha) {
    throw new Error('Defina ADMINISTRADOR_INICIAL e SENHA_INICIAL para criar o primeiro administrador.');
  }
  const contaInicial = validarConta({ usuario, senha });
  if (contaInicial.erro) throw new Error(`Credenciais iniciais inválidas. ${contaInicial.erro}`);
  const { sal, hash } = criarHash(contaInicial.senha);
  banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES (?, ?)').run(contaInicial.usuario, `${sal}:${hash}`);
  console.log(`Administrador inicial criado: ${contaInicial.usuario}`);
}

// Converte JSON das requisições em objetos e publica os arquivos da pasta public.
aplicativo.use(express.json({ limit: '20kb' }));
aplicativo.use(express.static(caminho.join(__dirname, 'public')));

function exigirAdministrador(requisicao, resposta, proximo) {
  // O navegador envia o cookie; o token identifica uma sessão que expira em oito horas.
  const cookie = requisicao.headers.cookie || '';
  const token = cookie.match(/(?:^|;\s*)sessao=([^;]+)/)?.[1];
  const sessao = token && sessoes.get(token);
  if (!sessao || sessao.expiraEm < Date.now()) {
    if (token) sessoes.delete(token);
    return resposta.status(401).json({ erro: 'Entre com sua conta de administrador.' });
  }
  // Confere também no banco se a conta ainda existe (por exemplo, se foi removida).
  const administrador = banco.prepare('SELECT id, usuario FROM administradores WHERE id = ?').get(sessao.administradorId);
  if (!administrador) {
    sessoes.delete(token);
    return resposta.status(401).json({ erro: 'Sua sessão terminou. Entre novamente.' });
  }
  requisicao.administrador = administrador;
  requisicao.tokenSessao = token;
  proximo();
}

function validarDoador(dados) {
  // Mantém somente os campos esperados e remove espaços extras antes de salvar.
  const campos = ['nome', 'email', 'telefone', 'cidade', 'tamanho', 'observacao'];
  const doador = Object.fromEntries(campos.map((campo) => [campo, String(dados[campo] ?? '').trim()]));
  const obrigatorios = ['nome', 'email', 'telefone', 'cidade', 'tamanho'];
  if (obrigatorios.some((campo) => !doador[campo])) return { erro: 'Preencha todos os campos obrigatórios.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doador.email)) return { erro: 'Informe um e-mail válido.' };
  if (campos.some((campo) => doador[campo].length > 200)) return { erro: 'Os campos devem ter no máximo 200 caracteres.' };
  return { doador };
}

function validarConta(dados, exigirSenha = true) {
  // Na edição, senha vazia significa "manter a senha atual"; senha preenchida é validada.
  const usuario = String(dados.usuario ?? '').trim();
  const senha = String(dados.senha ?? '');
  if (usuario.length < 3 || usuario.length > 50) return { erro: 'O usuário deve ter entre 3 e 50 caracteres.' };
  if (((exigirSenha || senha) && senha.length < 8) || senha.length > 100) return { erro: 'A senha deve ter entre 8 e 100 caracteres.' };
  return { usuario, senha };
}

function salvarDoador(requisicao, resposta, proximo) {
  const resultado = validarDoador(requisicao.body);
  if (resultado.erro) return resposta.status(400).json({ erro: resultado.erro });
  requisicao.doador = resultado.doador;
  proximo();
}

function tratarErro(error, requisicao, resposta, proximo) {
  // E-mail e usuário são únicos no SQLite; erros inesperados recebem uma resposta genérica.
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return resposta.status(409).json({ erro: 'Este e-mail ou usuário já está cadastrado.' });
  console.error(error);
  if (resposta.headersSent) return proximo(error);
  return resposta.status(500).json({ erro: 'Ocorreu um erro inesperado. Tente novamente.' });
}

// POST recebe as credenciais, verifica o hash e cria um cookie de sessão protegido.
aplicativo.post('/api/entrar', (requisicao, resposta) => {
  const { usuario, senha } = validarConta(requisicao.body);
  if (!usuario || !senha) return resposta.status(400).json({ erro: 'Informe usuário e senha.' });
  const administrador = banco.prepare('SELECT * FROM administradores WHERE usuario = ? COLLATE NOCASE').get(usuario);
  if (!administrador) return resposta.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  const [sal, hashSalvo] = administrador.senha_hash.split(':');
  const hashInformado = criarHash(senha, sal).hash;
  // Compara os hashes em tempo constante para reduzir vazamento de informação temporal.
  if (!criptografia.timingSafeEqual(Buffer.from(hashSalvo, 'hex'), Buffer.from(hashInformado, 'hex'))) {
    return resposta.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  const token = criptografia.randomBytes(32).toString('hex');
  sessoes.set(token, { administradorId: administrador.id, expiraEm: Date.now() + 8 * 60 * 60 * 1000 });
  resposta.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${requisicao.secure ? '; Secure' : ''}`);
  return resposta.json({ usuario: administrador.usuario });
});

// Sair apaga o token do servidor e manda o navegador apagar o cookie.
aplicativo.post('/api/sair', (requisicao, resposta) => {
  const token = (requisicao.headers.cookie || '').match(/(?:^|;\s*)sessao=([^;]+)/)?.[1];
  if (token) sessoes.delete(token);
  resposta.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return resposta.status(204).end();
});

aplicativo.get('/api/sessao', exigirAdministrador, (requisicao, resposta) => resposta.json(requisicao.administrador));

// A inscrição é pública: valida os dados e usa parâmetros SQL para gravar com segurança.
aplicativo.post('/api/doadores', salvarDoador, (requisicao, resposta) => {
  try {
    const inserir = banco.prepare(`INSERT INTO doadores (nome, email, telefone, cidade, tamanho, observacao)
      VALUES (@nome, @email, @telefone, @cidade, @tamanho, @observacao)`);
    const id = inserir.run(requisicao.doador).lastInsertRowid;
    return resposta.status(201).json(banco.prepare('SELECT * FROM doadores WHERE id = ?').get(id));
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

// A listagem é privada; a mesma rota filtra por nome, e-mail ou cidade quando há busca.
aplicativo.get('/api/doadores', exigirAdministrador, (requisicao, resposta) => {
  const busca = String(requisicao.query.busca || '').trim();
  const doadores = banco.prepare(`SELECT * FROM doadores
    WHERE nome LIKE @busca OR email LIKE @busca OR cidade LIKE @busca
    ORDER BY criado_em DESC, id DESC`).all({ busca: `%${busca}%` });
  resposta.json(doadores);
});

// PUT substitui os dados de um doador existente; primeiro exige login, depois valida.
aplicativo.put('/api/doadores/:id', exigirAdministrador, salvarDoador, (requisicao, resposta) => {
  try {
    const resultado = banco.prepare(`UPDATE doadores SET nome=@nome, email=@email, telefone=@telefone,
      cidade=@cidade, tamanho=@tamanho, observacao=@observacao, atualizado_em=CURRENT_TIMESTAMP WHERE id=@id`)
      .run({ ...requisicao.doador, id: Number(requisicao.params.id) });
    if (!resultado.changes) return resposta.status(404).json({ erro: 'Doador não encontrado.' });
    return resposta.json(banco.prepare('SELECT * FROM doadores WHERE id = ?').get(Number(requisicao.params.id)));
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

// DELETE remove o cadastro e informa 404 quando o identificador não existe.
aplicativo.delete('/api/doadores/:id', exigirAdministrador, (requisicao, resposta) => {
  const resultado = banco.prepare('DELETE FROM doadores WHERE id = ?').run(Number(requisicao.params.id));
  if (!resultado.changes) return resposta.status(404).json({ erro: 'Doador não encontrado.' });
  return resposta.status(204).end();
});

// As três rotas seguintes permitem que um administrador gerencie outras contas.
aplicativo.get('/api/administradores', exigirAdministrador, (requisicao, resposta) => {
  resposta.json(banco.prepare('SELECT id, usuario, criado_em FROM administradores ORDER BY usuario').all());
});

aplicativo.post('/api/administradores', exigirAdministrador, (requisicao, resposta) => {
  const conta = validarConta(requisicao.body);
  if (conta.erro) return resposta.status(400).json({ erro: conta.erro });
  const { sal, hash } = criarHash(conta.senha);
  try {
    const resultado = banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES (?, ?)').run(conta.usuario, `${sal}:${hash}`);
    return resposta.status(201).json({ id: resultado.lastInsertRowid, usuario: conta.usuario });
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.put('/api/administradores/:id', exigirAdministrador, (requisicao, resposta) => {
  const conta = validarConta(requisicao.body, false);
  if (conta.erro) return resposta.status(400).json({ erro: conta.erro });
  const id = Number(requisicao.params.id);
  try {
    if (conta.senha) {
      const { sal, hash } = criarHash(conta.senha);
      banco.prepare('UPDATE administradores SET usuario = ?, senha_hash = ? WHERE id = ?').run(conta.usuario, `${sal}:${hash}`, id);
    } else {
      banco.prepare('UPDATE administradores SET usuario = ? WHERE id = ?').run(conta.usuario, id);
    }
    const administrador = banco.prepare('SELECT id, usuario FROM administradores WHERE id = ?').get(id);
    if (!administrador) return resposta.status(404).json({ erro: 'Administrador não encontrado.' });
    return resposta.json(administrador);
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.delete('/api/administradores/:id', exigirAdministrador, (requisicao, resposta) => {
  const id = Number(requisicao.params.id);
  // Evita que alguém remova a própria conta ou deixe o sistema sem administrador.
  if (id === requisicao.administrador.id) return resposta.status(400).json({ erro: 'Entre com outra conta para remover este administrador.' });
  const quantidade = banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get().quantidade;
  if (quantidade <= 1) return resposta.status(400).json({ erro: 'O último administrador não pode ser removido.' });
  const resultado = banco.prepare('DELETE FROM administradores WHERE id = ?').run(id);
  if (!resultado.changes) return resposta.status(404).json({ erro: 'Administrador não encontrado.' });
  return resposta.status(204).end();
});

// Este middleware recebe erros que não foram tratados diretamente por uma rota.
aplicativo.use(tratarErro);

// 0.0.0.0 aceita conexões de fora do container Docker, além do próprio computador.
aplicativo.listen(porta, '0.0.0.0', () => {
  console.log(`Campanha do Agasalho disponível em http://localhost:${porta}`);
});