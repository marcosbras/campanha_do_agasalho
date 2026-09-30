const formularioDoador = document.querySelector('#formulario-doador');
const listaDoadores = document.querySelector('#lista-doadores');
const estadoVazio = document.querySelector('#estado-vazio');
const campoBusca = document.querySelector('#busca-doadores');
const formularioAdministrador = document.querySelector('#formulario-administrador');
const listaAdministradores = document.querySelector('#lista-administradores');
const modalAgradecimento = new bootstrap.Modal(document.querySelector('#modal-agradecimento'));
const modalEntrar = new bootstrap.Modal(document.querySelector('#modal-entrar'));
// Guardamos os IDs em edição para decidir entre criar um registro e atualizá-lo.
let idDoadorEmEdicao = null;
let idAdministradorEmEdicao = null;
let temporizadorBusca;

function mostrarAviso(elemento, mensagem, tipo = 'danger') {
  elemento.textContent = mensagem;
  elemento.className = `alert alert-${tipo}`;
}

function limparAviso(elemento) {
  elemento.textContent = '';
  elemento.className = 'alert d-none';
}

function escaparHtml(valor = '') {
  // Nomes e cidades são digitados por usuários; escapá-los evita interpretar texto como HTML.
  return String(valor).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

async function chamarApi(url, opcoes = {}) {
  // Centraliza fetch, JSON e mensagens de erro para as demais funções ficarem menores.
  const resposta = await fetch(url, {
    ...opcoes,
    headers: { ...(opcoes.body ? { 'Content-Type': 'application/json' } : {}), ...opcoes.headers }
  });
  if (!resposta.ok) {
    const resultado = await resposta.json().catch(() => ({}));
    throw new Error(resultado.erro || 'Não foi possível concluir a solicitação.');
  }
  return resposta.status === 204 ? null : resposta.json();
}

function formatarData(valor) {
  return new Date(`${valor.replace(' ', 'T')}Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function mostrarDoadores(doadores) {
  // Cria uma linha visual para cada doador retornado pela API.
  document.querySelector('#quantidade-doadores').textContent = doadores.length;
  estadoVazio.classList.toggle('d-none', doadores.length > 0);
  listaDoadores.innerHTML = doadores.map((doador, indice) => `
    <article class="donor-row" style="--row-index: ${indice}">
      <span class="donor-avatar avatar-${indice % 5}">${escaparHtml(doador.nome.trim().split(/\s+/).slice(0, 2).map((parte) => parte[0]).join('').toLocaleUpperCase('pt-BR'))}</span>
      <div class="donor-info"><strong>${escaparHtml(doador.nome)}</strong><span>${escaparHtml(doador.cidade)} <i>·</i> ${escaparHtml(doador.tamanho)}</span></div>
      <span class="donor-date">${escaparHtml(formatarData(doador.criado_em))}</span>
      <div class="donor-actions">
        <button class="icon-button editar-doador" type="button" data-id="${doador.id}" aria-label="Editar cadastro de ${escaparHtml(doador.nome)}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button class="icon-button excluir-doador" type="button" data-id="${doador.id}" aria-label="Excluir cadastro de ${escaparHtml(doador.nome)}" title="Excluir"><i class="bi bi-trash3"></i></button>
      </div>
    </article>`).join('');
}

async function carregarDoadores(busca = '') {
  // Esta chamada só funciona após o login; o servidor verifica o cookie da sessão.
  listaDoadores.innerHTML = '<div class="loading-state"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Buscando gestos de carinho...</div>';
  estadoVazio.classList.add('d-none');
  try {
    mostrarDoadores(await chamarApi(`/api/doadores?busca=${encodeURIComponent(busca)}`));
  } catch (erro) {
    listaDoadores.innerHTML = `<p class="list-error">${escaparHtml(erro.message)}</p>`;
  }
}

function redefinirFormularioDoador() {
  idDoadorEmEdicao = null;
  formularioDoador.reset();
  limparAviso(document.querySelector('#aviso-formulario'));
  document.querySelector('#titulo-formulario').textContent = 'Quero doar';
  document.querySelector('#botao-enviar span').textContent = 'Quero fazer parte';
  document.querySelector('#botao-cancelar-edicao').classList.add('d-none');
}

function mostrarPainel(usuario) {
  // Só revela as ferramentas privadas depois que o servidor confirmou a sessão.
  document.querySelector('#nome-administrador').textContent = usuario;
  document.querySelector('#coluna-formulario-doador').classList.replace('col-lg-12', 'col-lg-5');
  document.querySelector('#area-administrativa').classList.remove('d-none');
  document.querySelector('#total-doadores').classList.remove('d-none');
  document.querySelector('#botao-entrar').classList.add('d-none');
  document.querySelector('#botao-sair').classList.remove('d-none');
  carregarDoadores(campoBusca.value.trim());
  carregarAdministradores();
}

function ocultarPainel() {
  // Esconde informações administrativas quando o administrador encerra a sessão.
  document.querySelector('#coluna-formulario-doador').classList.replace('col-lg-5', 'col-lg-12');
  document.querySelector('#area-administrativa').classList.add('d-none');
  document.querySelector('#total-doadores').classList.add('d-none');
  document.querySelector('#botao-entrar').classList.remove('d-none');
  document.querySelector('#botao-sair').classList.add('d-none');
  listaDoadores.innerHTML = '';
  listaAdministradores.innerHTML = '';
}

formularioDoador.addEventListener('submit', async (evento) => {
  // O mesmo formulário atende à inscrição e à edição de um cadastro existente.
  evento.preventDefault();
  const aviso = document.querySelector('#aviso-formulario');
  limparAviso(aviso);
  if (!formularioDoador.reportValidity()) return;
  const doador = Object.fromEntries(new FormData(formularioDoador).entries());
  const editando = idDoadorEmEdicao !== null;
  const botao = document.querySelector('#botao-enviar');
  botao.disabled = true;
  botao.querySelector('span').textContent = editando ? 'Salvando...' : 'Enviando carinho...';
  try {
    await chamarApi(editando ? `/api/doadores/${idDoadorEmEdicao}` : '/api/doadores', {
      method: editando ? 'PUT' : 'POST', body: JSON.stringify(doador)
    });
    redefinirFormularioDoador();
    if (editando) {
      mostrarAviso(aviso, 'Cadastro atualizado com carinho.', 'success');
      await carregarDoadores(campoBusca.value.trim());
    } else {
      modalAgradecimento.show();
      if (!document.querySelector('#area-administrativa').classList.contains('d-none')) await carregarDoadores(campoBusca.value.trim());
    }
  } catch (erro) {
    mostrarAviso(aviso, erro.message);
  } finally {
    botao.disabled = false;
    if (idDoadorEmEdicao === null) botao.querySelector('span').textContent = 'Quero fazer parte';
  }
});

listaDoadores.addEventListener('click', async (evento) => {
  // Um único listener trata os botões de editar e excluir de todas as linhas da lista.
  const botaoEditar = evento.target.closest('.editar-doador');
  const botaoExcluir = evento.target.closest('.excluir-doador');
  if (botaoEditar) {
    try {
      const doadores = await chamarApi('/api/doadores');
      const doador = doadores.find((item) => item.id === Number(botaoEditar.dataset.id));
      if (!doador) return;
      for (const [campo, valor] of Object.entries(doador)) {
        // Os nomes dos campos do formulário correspondem aos nomes das colunas no banco.
        const entrada = formularioDoador.elements.namedItem(campo);
        if (entrada) entrada.value = valor;
      }
      idDoadorEmEdicao = doador.id;
      document.querySelector('#titulo-formulario').textContent = 'Editar cadastro';
      document.querySelector('#botao-enviar span').textContent = 'Salvar alterações';
      document.querySelector('#botao-cancelar-edicao').classList.remove('d-none');
      formularioDoador.scrollIntoView({ behavior: 'smooth', block: 'center' });
      formularioDoador.elements.namedItem('nome').focus({ preventScroll: true });
    } catch (erro) {
      mostrarAviso(document.querySelector('#aviso-formulario'), erro.message);
    }
  }
  if (botaoExcluir) {
    const nome = botaoExcluir.closest('.donor-row').querySelector('.donor-info strong').textContent;
    if (!window.confirm(`Deseja mesmo remover o cadastro de ${nome}?`)) return;
    try {
      await chamarApi(`/api/doadores/${botaoExcluir.dataset.id}`, { method: 'DELETE' });
      if (idDoadorEmEdicao === Number(botaoExcluir.dataset.id)) redefinirFormularioDoador();
      await carregarDoadores(campoBusca.value.trim());
    } catch (erro) {
      mostrarAviso(document.querySelector('#aviso-formulario'), erro.message);
    }
  }
});

async function carregarAdministradores() {
  // A senha nunca é enviada para a tela; a API retorna apenas identificador e usuário.
  try {
    const administradores = await chamarApi('/api/administradores');
    listaAdministradores.innerHTML = administradores.map((administrador) => `
      <div class="d-flex align-items-center justify-content-between gap-2 border-bottom py-2">
        <span>${escaparHtml(administrador.usuario)}</span>
        <span class="d-flex gap-1">
          <button class="icon-button editar-administrador" type="button" data-id="${administrador.id}" data-usuario="${escaparHtml(administrador.usuario)}" title="Editar usuário ou senha" aria-label="Editar ${escaparHtml(administrador.usuario)}"><i class="bi bi-pencil"></i></button>
          <button class="icon-button excluir-administrador" type="button" data-id="${administrador.id}" title="Remover administrador" aria-label="Remover ${escaparHtml(administrador.usuario)}"><i class="bi bi-trash3"></i></button>
        </span>
      </div>`).join('');
  } catch (erro) {
    listaAdministradores.textContent = erro.message;
  }
}

function redefinirFormularioAdministrador() {
  // Ao voltar para "adicionar", a senha volta a ser obrigatória.
  idAdministradorEmEdicao = null;
  formularioAdministrador.reset();
  formularioAdministrador.elements.namedItem('senha').required = true;
  document.querySelector('#titulo-formulario-administrador').textContent = 'Adicionar administrador';
  document.querySelector('#botao-salvar-administrador').textContent = 'Adicionar administrador';
  document.querySelector('#dica-senha').textContent = '(mínimo 8 caracteres)';
  document.querySelector('#botao-cancelar-administrador').classList.add('d-none');
  limparAviso(document.querySelector('#aviso-administrador'));
}

formularioAdministrador.addEventListener('submit', async (evento) => {
  // Se houver um ID, atualiza a conta; sem ID, cria uma nova.
  evento.preventDefault();
  const aviso = document.querySelector('#aviso-administrador');
  limparAviso(aviso);
  const conta = Object.fromEntries(new FormData(formularioAdministrador).entries());
  const editando = idAdministradorEmEdicao !== null;
  try {
    await chamarApi(editando ? `/api/administradores/${idAdministradorEmEdicao}` : '/api/administradores', {
      method: editando ? 'PUT' : 'POST', body: JSON.stringify(conta)
    });
    redefinirFormularioAdministrador();
    mostrarAviso(aviso, editando ? 'Administrador atualizado.' : 'Administrador adicionado.', 'success');
    await carregarAdministradores();
  } catch (erro) {
    mostrarAviso(aviso, erro.message);
  }
});

listaAdministradores.addEventListener('click', async (evento) => {
  // A edição pode trocar o usuário e opcionalmente a senha; excluir pede confirmação.
  const botaoEditar = evento.target.closest('.editar-administrador');
  const botaoExcluir = evento.target.closest('.excluir-administrador');
  if (botaoEditar) {
    idAdministradorEmEdicao = Number(botaoEditar.dataset.id);
    formularioAdministrador.elements.namedItem('usuario').value = botaoEditar.dataset.usuario;
    formularioAdministrador.elements.namedItem('senha').value = '';
    formularioAdministrador.elements.namedItem('senha').required = false;
    document.querySelector('#titulo-formulario-administrador').textContent = 'Editar administrador';
    document.querySelector('#botao-salvar-administrador').textContent = 'Salvar alterações';
    document.querySelector('#dica-senha').textContent = '(deixe vazio para manter a senha atual)';
    document.querySelector('#botao-cancelar-administrador').classList.remove('d-none');
    formularioAdministrador.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (botaoExcluir && window.confirm('Deseja mesmo remover este administrador?')) {
    try {
      await chamarApi(`/api/administradores/${botaoExcluir.dataset.id}`, { method: 'DELETE' });
      await carregarAdministradores();
    } catch (erro) {
      mostrarAviso(document.querySelector('#aviso-administrador'), erro.message);
    }
  }
});

document.querySelector('#formulario-entrar').addEventListener('submit', async (evento) => {
  // O navegador guarda o cookie HttpOnly recebido do servidor para as próximas chamadas.
  evento.preventDefault();
  const aviso = document.querySelector('#aviso-entrar');
  limparAviso(aviso);
  try {
    const conta = Object.fromEntries(new FormData(evento.currentTarget).entries());
    const resultado = await chamarApi('/api/entrar', { method: 'POST', body: JSON.stringify(conta) });
    modalEntrar.hide();
    evento.currentTarget.reset();
    mostrarPainel(resultado.usuario);
  } catch (erro) {
    mostrarAviso(aviso, erro.message);
  }
});

document.querySelector('#botao-sair').addEventListener('click', async () => {
  await chamarApi('/api/sair', { method: 'POST' });
  ocultarPainel();
});

document.querySelector('#botao-cancelar-edicao').addEventListener('click', redefinirFormularioDoador);
document.querySelector('#botao-cancelar-administrador').addEventListener('click', redefinirFormularioAdministrador);
campoBusca.addEventListener('input', () => {
  // Espera a pessoa terminar de digitar antes de pesquisar, evitando uma chamada por tecla.
  window.clearTimeout(temporizadorBusca);
  temporizadorBusca = window.setTimeout(() => carregarDoadores(campoBusca.value.trim()), 250);
});

// Ao recarregar a página, pergunta ao servidor se já existe uma sessão válida.
chamarApi('/api/sessao').then((administrador) => mostrarPainel(administrador.usuario)).catch(() => {});