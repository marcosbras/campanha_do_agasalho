// Os módulos node:* já vêm com o Node.js; Express e better-sqlite3 são instalados pelo npm.
const caminho = require('node:path');
const fs = require('node:fs');
const criptografia = require('node:crypto');
const express = require('express');
const { Pool } = require('pg');
const BancoSQLite = require('better-sqlite3');

const arquivoEnv = caminho.join(__dirname, '.env');
if (fs.existsSync(arquivoEnv)) process.loadEnvFile(arquivoEnv);

const aplicativo = express();
const porta = Number(process.env.PORTA) || 3000;
const caminhoBanco = process.env.CAMINHO_BANCO || caminho.join(__dirname, 'data', 'doadores.sqlite');
const usoPostgres = Boolean(process.env.DATABASE_URL);
const sessoes = new Map();

function converterParametrosParaPostgres(sqlOriginal, parametros) {
  let sql = sqlOriginal.replace(/\s+COLLATE\s+NOCASE/gi, '');
  if (Array.isArray(parametros)) {
    if (parametros.length === 0) return { sql, params: undefined };
    let indice = 0;
    sql = sql.replace(/\?/g, () => `$${++indice}`);
    return { sql, params: parametros };
  }
  if (parametros && typeof parametros === 'object') {
    const chaves = Object.keys(parametros);
    if (chaves.length === 0) return { sql, params: undefined };
    for (const chave of chaves) {
      sql = sql.replace(new RegExp(`@${chave}\\b`, 'g'), `$${chave}`);
    }
    return { sql, params: parametros };
  }
  return { sql, params: undefined };
}

function criarBancoPostgres() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.VERCEL ? { rejectUnauthorized: false } : false
  });

  const preparar = (sql) => ({
    get: async (parametros) => {
      const { sql: sqlPg, params } = converterParametrosParaPostgres(sql, parametros);
      const resultado = params === undefined ? await pool.query(sqlPg) : await pool.query(sqlPg, params);
      return resultado.rows[0] ?? undefined;
    },
    all: async (parametros) => {
      const { sql: sqlPg, params } = converterParametrosParaPostgres(sql, parametros);
      const resultado = params === undefined ? await pool.query(sqlPg) : await pool.query(sqlPg, params);
      return resultado.rows;
    },
    run: async (...argumentos) => {
      const parametros = argumentos.length <= 1 ? (argumentos[0] ?? []) : argumentos;
      const { sql: sqlPg, params } = converterParametrosParaPostgres(sql, parametros);
      const consultaFinal = /^\s*INSERT\b/i.test(sqlPg) ? `${sqlPg.trim()} RETURNING id` : sqlPg;
      const resultado = params === undefined ? await pool.query(consultaFinal) : await pool.query(consultaFinal, params);
      return {
        changes: Number(resultado.rowCount || 0),
        lastInsertRowid: resultado.rows?.[0]?.id ?? null
      };
    }
  });

  const executa = async (sql) => pool.query(sql);
  return { type: 'postgres', pool, prepare: preparar, exec: executa };
}

function criarBancoSqlite() {
  fs.mkdirSync(caminho.dirname(caminhoBanco), { recursive: true });
  const banco = new BancoSQLite(caminhoBanco);
  banco.pragma('journal_mode = WAL');
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

  const tabelaAntigaExiste = banco.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'donors'").get();
  if (tabelaAntigaExiste) {
    banco.exec(`
      INSERT OR IGNORE INTO doadores (id, nome, email, telefone, cidade, tamanho, observacao, criado_em, atualizado_em)
      SELECT id, name, email, phone, city, clothing_size, message, created_at, updated_at FROM donors;
    `);
  }

  return {
    type: 'sqlite',
    prepare: (sql) => {
      const declaracao = banco.prepare(sql);
      return {
        get: (parametros) => {
          if (parametros === undefined || (Array.isArray(parametros) && parametros.length === 0) || (parametros && typeof parametros === 'object' && Object.keys(parametros).length === 0)) {
            return declaracao.get();
          }
          return declaracao.get(parametros);
        },
        all: (parametros) => {
          if (parametros === undefined || (Array.isArray(parametros) && parametros.length === 0) || (parametros && typeof parametros === 'object' && Object.keys(parametros).length === 0)) {
            return declaracao.all();
          }
          return declaracao.all(parametros);
        },
        run: (...argumentos) => {
          const resultado = argumentos.length === 0 ? declaracao.run() : declaracao.run(...argumentos);
          return {
            changes: resultado.changes,
            lastInsertRowid: resultado.lastInsertRowid
          };
        }
      };
    },
    exec: (sql) => banco.exec(sql)
  };
}

const banco = usoPostgres ? criarBancoPostgres() : criarBancoSqlite();

async function inicializarBanco() {
  if (usoPostgres) {
    await banco.exec(`
      CREATE TABLE IF NOT EXISTS doadores (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        telefone TEXT NOT NULL,
        cidade TEXT NOT NULL,
        tamanho TEXT NOT NULL,
        observacao TEXT NOT NULL DEFAULT '',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS administradores (
        id SERIAL PRIMARY KEY,
        usuario TEXT NOT NULL UNIQUE,
        senha_hash TEXT NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  const totalAdministradores = usoPostgres
    ? (await banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get()).quantidade
    : banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get().quantidade;

  if (totalAdministradores === 0) {
    const usuario = process.env.ADMINISTRADOR_INICIAL;
    const senha = process.env.SENHA_INICIAL;
    if (!usuario || !senha) {
      throw new Error('Defina ADMINISTRADOR_INICIAL e SENHA_INICIAL para criar o primeiro administrador.');
    }
    const contaInicial = validarConta({ usuario, senha });
    if (contaInicial.erro) throw new Error(`Credenciais iniciais inválidas. ${contaInicial.erro}`);
    const { sal, hash } = criarHash(contaInicial.senha);
    if (usoPostgres) {
      await banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES ($1, $2)').run(contaInicial.usuario, `${sal}:${hash}`);
    } else {
      banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES (?, ?)').run(contaInicial.usuario, `${sal}:${hash}`);
    }
    console.log(`Administrador inicial criado: ${contaInicial.usuario}`);
  }
}

// O sal aleatório impede hashes iguais para senhas iguais; a senha original não é salva.
const criarHash = (senha, sal = criptografia.randomBytes(16).toString('hex')) => ({
  sal,
  hash: criptografia.scryptSync(senha, sal, 64).toString('hex')
});

// Converte JSON das requisições em objetos e publica os arquivos da pasta public.
aplicativo.use(express.json({ limit: '20kb' }));
aplicativo.use(express.static(caminho.join(__dirname, 'public')));

async function exigirAdministrador(requisicao, resposta, proximo) {
  // O navegador envia o cookie; o token identifica uma sessão que expira em oito horas.
  const cookie = requisicao.headers.cookie || '';
  const token = cookie.match(/(?:^|;\s*)sessao=([^;]+)/)?.[1];
  const sessao = token && sessoes.get(token);
  if (!sessao || sessao.expiraEm < Date.now()) {
    if (token) sessoes.delete(token);
    return resposta.status(401).json({ erro: 'Entre com sua conta de administrador.' });
  }
  const administrador = usoPostgres
    ? await banco.prepare('SELECT id, usuario FROM administradores WHERE id = $1').get(sessao.administradorId)
    : banco.prepare('SELECT id, usuario FROM administradores WHERE id = ?').get(sessao.administradorId);
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
  const codigoErro = error?.code ?? '';
  if (codigoErro === 'SQLITE_CONSTRAINT_UNIQUE' || codigoErro === '23505') return resposta.status(409).json({ erro: 'Este e-mail ou usuário já está cadastrado.' });
  console.error(error);
  if (resposta.headersSent) return proximo(error);
  return resposta.status(500).json({ erro: 'Ocorreu um erro inesperado. Tente novamente.' });
}

aplicativo.post('/api/entrar', async (requisicao, resposta) => {
  const { usuario, senha } = validarConta(requisicao.body);
  if (!usuario || !senha) return resposta.status(400).json({ erro: 'Informe usuário e senha.' });
  const consulta = usoPostgres
    ? 'SELECT * FROM administradores WHERE LOWER(usuario) = LOWER($1)'
    : 'SELECT * FROM administradores WHERE usuario = ? COLLATE NOCASE';
  const administrador = usoPostgres
    ? await banco.prepare(consulta).get(usuario)
    : banco.prepare(consulta).get(usuario);
  if (!administrador) return resposta.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  const [sal, hashSalvo] = administrador.senha_hash.split(':');
  const hashInformado = criarHash(senha, sal).hash;
  if (!criptografia.timingSafeEqual(Buffer.from(hashSalvo, 'hex'), Buffer.from(hashInformado, 'hex'))) {
    return resposta.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  const token = criptografia.randomBytes(32).toString('hex');
  sessoes.set(token, { administradorId: administrador.id, expiraEm: Date.now() + 8 * 60 * 60 * 1000 });
  resposta.setHeader('Set-Cookie', `sessao=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${requisicao.secure ? '; Secure' : ''}`);
  return resposta.json({ usuario: administrador.usuario });
});

aplicativo.post('/api/sair', (requisicao, resposta) => {
  const token = (requisicao.headers.cookie || '').match(/(?:^|;\s*)sessao=([^;]+)/)?.[1];
  if (token) sessoes.delete(token);
  resposta.setHeader('Set-Cookie', 'sessao=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return resposta.status(204).end();
});

aplicativo.get('/api/sessao', exigirAdministrador, async (requisicao, resposta) => {
  const administrador = usoPostgres
    ? await banco.prepare('SELECT id, usuario FROM administradores WHERE id = $1').get(requisicao.administrador.id)
    : banco.prepare('SELECT id, usuario FROM administradores WHERE id = ?').get(requisicao.administrador.id);
  return resposta.json(administrador);
});

aplicativo.post('/api/doadores', salvarDoador, async (requisicao, resposta) => {
  try {
    const inserir = banco.prepare(usoPostgres
      ? `INSERT INTO doadores (nome, email, telefone, cidade, tamanho, observacao)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
      : `INSERT INTO doadores (nome, email, telefone, cidade, tamanho, observacao)
        VALUES (@nome, @email, @telefone, @cidade, @tamanho, @observacao)`);
    const resultado = usoPostgres
      ? await inserir.run(requisicao.doador.nome, requisicao.doador.email, requisicao.doador.telefone, requisicao.doador.cidade, requisicao.doador.tamanho, requisicao.doador.observacao)
      : inserir.run(requisicao.doador);
    const id = usoPostgres ? resultado.lastInsertRowid : resultado.lastInsertRowid;
    const doador = usoPostgres
      ? await banco.prepare('SELECT * FROM doadores WHERE id = $1').get(id)
      : banco.prepare('SELECT * FROM doadores WHERE id = ?').get(id);
    return resposta.status(201).json(doador);
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.get('/api/doadores', exigirAdministrador, async (requisicao, resposta) => {
  const busca = String(requisicao.query.busca || '').trim();
  const consulta = usoPostgres
    ? `SELECT * FROM doadores
      WHERE LOWER(nome) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1) OR LOWER(cidade) LIKE LOWER($1)
      ORDER BY criado_em DESC, id DESC`
    : `SELECT * FROM doadores
      WHERE nome LIKE @busca OR email LIKE @busca OR cidade LIKE @busca
      ORDER BY criado_em DESC, id DESC`;
  const doadores = usoPostgres
    ? await banco.prepare(consulta).all(`%${busca}%`)
    : banco.prepare(consulta).all({ busca: `%${busca}%` });
  resposta.json(doadores);
});

aplicativo.put('/api/doadores/:id', exigirAdministrador, salvarDoador, async (requisicao, resposta) => {
  try {
    const consulta = usoPostgres
      ? `UPDATE doadores SET nome=$1, email=$2, telefone=$3, cidade=$4, tamanho=$5, observacao=$6, atualizado_em=NOW() WHERE id=$7`
      : `UPDATE doadores SET nome=@nome, email=@email, telefone=@telefone, cidade=@cidade, tamanho=@tamanho, observacao=@observacao, atualizado_em=CURRENT_TIMESTAMP WHERE id=@id`;
    const resultado = usoPostgres
      ? await banco.prepare(consulta).run(
          requisicao.doador.nome,
          requisicao.doador.email,
          requisicao.doador.telefone,
          requisicao.doador.cidade,
          requisicao.doador.tamanho,
          requisicao.doador.observacao,
          Number(requisicao.params.id)
        )
      : banco.prepare(consulta).run({ ...requisicao.doador, id: Number(requisicao.params.id) });
    if (!resultado.changes) return resposta.status(404).json({ erro: 'Doador não encontrado.' });
    const doador = usoPostgres
      ? await banco.prepare('SELECT * FROM doadores WHERE id = $1').get(Number(requisicao.params.id))
      : banco.prepare('SELECT * FROM doadores WHERE id = ?').get(Number(requisicao.params.id));
    return resposta.json(doador);
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.delete('/api/doadores/:id', exigirAdministrador, async (requisicao, resposta) => {
  const resultado = usoPostgres
    ? await banco.prepare('DELETE FROM doadores WHERE id = $1').run(Number(requisicao.params.id))
    : banco.prepare('DELETE FROM doadores WHERE id = ?').run(Number(requisicao.params.id));
  if (!resultado.changes) return resposta.status(404).json({ erro: 'Doador não encontrado.' });
  return resposta.status(204).end();
});

aplicativo.get('/api/administradores', exigirAdministrador, async (requisicao, resposta) => {
  const administradores = usoPostgres
    ? await banco.prepare('SELECT id, usuario, criado_em FROM administradores ORDER BY usuario').all()
    : banco.prepare('SELECT id, usuario, criado_em FROM administradores ORDER BY usuario').all();
  resposta.json(administradores);
});

aplicativo.post('/api/administradores', exigirAdministrador, async (requisicao, resposta) => {
  const conta = validarConta(requisicao.body);
  if (conta.erro) return resposta.status(400).json({ erro: conta.erro });
  const { sal, hash } = criarHash(conta.senha);
  try {
    const resultado = usoPostgres
      ? await banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES ($1, $2)').run(conta.usuario, `${sal}:${hash}`)
      : banco.prepare('INSERT INTO administradores (usuario, senha_hash) VALUES (?, ?)').run(conta.usuario, `${sal}:${hash}`);
    return resposta.status(201).json({ id: resultado.lastInsertRowid, usuario: conta.usuario });
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.put('/api/administradores/:id', exigirAdministrador, async (requisicao, resposta) => {
  const conta = validarConta(requisicao.body, false);
  if (conta.erro) return resposta.status(400).json({ erro: conta.erro });
  const id = Number(requisicao.params.id);
  try {
    if (conta.senha) {
      const { sal, hash } = criarHash(conta.senha);
      if (usoPostgres) {
        await banco.prepare('UPDATE administradores SET usuario = $1, senha_hash = $2 WHERE id = $3').run(conta.usuario, `${sal}:${hash}`, id);
      } else {
        banco.prepare('UPDATE administradores SET usuario = ?, senha_hash = ? WHERE id = ?').run(conta.usuario, `${sal}:${hash}`, id);
      }
    } else if (usoPostgres) {
      await banco.prepare('UPDATE administradores SET usuario = $1 WHERE id = $2').run(conta.usuario, id);
    } else {
      banco.prepare('UPDATE administradores SET usuario = ? WHERE id = ?').run(conta.usuario, id);
    }
    const administrador = usoPostgres
      ? await banco.prepare('SELECT id, usuario FROM administradores WHERE id = $1').get(id)
      : banco.prepare('SELECT id, usuario FROM administradores WHERE id = ?').get(id);
    if (!administrador) return resposta.status(404).json({ erro: 'Administrador não encontrado.' });
    return resposta.json(administrador);
  } catch (erro) { return tratarErro(erro, requisicao, resposta, () => {}); }
});

aplicativo.delete('/api/administradores/:id', exigirAdministrador, async (requisicao, resposta) => {
  const id = Number(requisicao.params.id);
  if (id === requisicao.administrador.id) return resposta.status(400).json({ erro: 'Entre com outra conta para remover este administrador.' });
  const quantidade = usoPostgres
    ? (await banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get()).quantidade
    : banco.prepare('SELECT COUNT(*) AS quantidade FROM administradores').get().quantidade;
  if (quantidade <= 1) return resposta.status(400).json({ erro: 'O último administrador não pode ser removido.' });
  const resultado = usoPostgres
    ? await banco.prepare('DELETE FROM administradores WHERE id = $1').run(id)
    : banco.prepare('DELETE FROM administradores WHERE id = ?').run(id);
  if (!resultado.changes) return resposta.status(404).json({ erro: 'Administrador não encontrado.' });
  return resposta.status(204).end();
});

aplicativo.use(tratarErro);

inicializarBanco().catch((erro) => {
  console.error('Erro ao inicializar o banco:', erro);
  if (require.main === module) process.exit(1);
});

if (require.main === module) {
  aplicativo.listen(porta, '0.0.0.0', () => {
    console.log(`Campanha do Agasalho disponível em http://localhost:${porta}`);
  });
}

module.exports = aplicativo;