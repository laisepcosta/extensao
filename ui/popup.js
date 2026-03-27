/**
 * ui/popup.js — Etapa 2: integração com eProc
 * Inclui Passo 0 (seleção de documentos) e orquestração do download.
 */

let estadoApp = {
  jsonBruto:  null,
  inputs:     null,
  templateId: 'cessao-credito'
};

document.addEventListener('DOMContentLoaded', function () {
  console.log('[Assistente] Iniciado. Template:', estadoApp.templateId);

  inicializarLocalStorage();

  const toggleDiv = (checkId, divId) => {
    const check = document.getElementById(checkId);
    const div   = document.getElementById(divId);
    if (check && div) {
      check.addEventListener('change', () => div.classList.toggle('hidden', !check.checked));
      div.classList.toggle('hidden', !check.checked);
    }
  };
  toggleDiv('existeDestaquePrevio', 'divDestaquePrevio');
  toggleDiv('deferidoNestaAnalise', 'divDestaqueNovo');

  document.getElementById('beneficiarioDestaquePrevio')
    ?.addEventListener('input', () => {
      if (estadoApp.jsonBruto) atualizarListaCedentes(estadoApp.jsonBruto);
    });

  _verificarIA();

  // ── Passo 0: ouvir dados do eProc ────────────────────────────────

  // O background nos avisa quando um processo é detectado
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tipo === 'DADOS_PROCESSO') {
      _receberDadosProcesso(msg.payload);
    }
  });

  // Verifica se havia dados pendentes no storage de sessão
  // (caso o painel tenha sido aberto ANTES da página carregar)
  chrome.storage.session.get('processoDetectado').then(resultado => {
    if (resultado.processoDetectado) {
      _receberDadosProcesso(resultado.processoDetectado);
      chrome.storage.session.remove('processoDetectado');
    }
  });

  // Botão "usar modo manual"
  document.getElementById('btnUsarModoManual')?.addEventListener('click', () => {
    _ativarModoManual();
  });

  // Botão "Analisar Documentos Selecionados"
  document.getElementById('btnAnalisarSelecionados')?.addEventListener('click', async () => {
    const anexos = documentSelector.getAnexosSelecionados();
    if (anexos.length === 0) {
      alert('Selecione pelo menos um documento para analisar.');
      return;
    }
    await _baixarEProcessar(anexos);
  });

  // ── Passo 1: botões ───────────────────────────────────────────────

  document.getElementById('btnSalvarJSON')?.addEventListener('click', function () {
    const rawInput = document.getElementById('jsonInput').value;
    try {
      estadoApp.jsonBruto = pdfHandler.extrairJSON(rawInput);
      _carregarDadosNaTela(estadoApp.jsonBruto);
    } catch (e) {
      alert('Erro ao ler JSON.\nErro: ' + e.message);
    }
  });

  document.getElementById('btnReiniciar')?.addEventListener('click', function () {
    if (confirm('Deseja limpar todos os dados e reiniciar?')) {
      localStorage.clear();
      window.location.reload();
    }
  });

  document.getElementById('btnGerarCertidao')?.addEventListener('click', function () {
    if (!estadoApp.jsonBruto) { alert('Por favor, carregue o JSON primeiro.'); return; }
    try {
      capturarInputsFinais();
      document.getElementById('tabelaCertidaoVisual').innerHTML =
        templateRenderer.renderizarCertidao(
          estadoApp.jsonBruto, estadoApp.inputs, estadoApp.templateId
        );
      mudarPasso(1, 2);
    } catch (erro) {
      console.error('[Assistente] Erro ao gerar certidão:', erro);
      alert('Erro ao gerar certidão. Verifique o console.');
    }
  });

  // ── Passo 2 → 3 ─────────────────────────────────────────────────

  document.getElementById('btnConfirmarCertidao')?.addEventListener('click', function () {
    try {
      const resultado = ruleEngine.processar(
        estadoApp.jsonBruto, estadoApp.inputs, estadoApp.templateId
      );
      const htmlMinuta = templateRenderer.renderizarMinuta(
        estadoApp.jsonBruto, estadoApp.inputs, resultado.textos, estadoApp.templateId
      );
      const htmlTabela = templateRenderer.renderizarTabela(
        resultado.tabela, estadoApp.templateId
      );
      document.getElementById('previaMinuta').innerHTML  = htmlMinuta;
      document.getElementById('previaTabela').innerHTML  = htmlTabela;
      document.getElementById('outputMinuta').value      = htmlMinuta;
      document.getElementById('outputTabela').value      = htmlTabela;
      mudarPasso(2, 3);
    } catch (erro) {
      console.error('[Assistente] Erro ao gerar minuta:', erro);
      alert('Erro ao processar regras: ' + erro.message);
    }
  });

  document.getElementById('btnVoltarPasso2')?.addEventListener('click', () => mudarPasso(3, 2));
  document.getElementById('btnVoltarPasso1')?.addEventListener('click', () => mudarPasso(2, 1));

  configurarCopia('btnCopiarMinuta', 'outputMinuta', 'Só Minuta');
  configurarCopia('btnCopiarTabela', 'outputTabela', 'Só Tabela');

  document.getElementById('btnCopiarTudo')?.addEventListener('click', function () {
    const texto = document.getElementById('outputMinuta').value + '\n\n' +
                  document.getElementById('outputTabela').value;
    navigator.clipboard.writeText(texto);
    this.innerText = '✓ Tudo Copiado!';
    this.style.backgroundColor = '#28a745';
    setTimeout(() => {
      this.innerText = '📋 Copiar Tudo (Minuta + Tabela)';
      this.style.backgroundColor = '#17a2b8';
    }, 2000);
  });

  // Listeners de validação em tempo real
  ['percDestaquePrevio', 'percDeferidoAgora', 'beneficiarioDestaquePrevio',
   'beneficiarioDestaqueNovo', 'certificarPerdaObjeto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(
      el.type === 'checkbox' ? 'change' : 'input',
      validarDestaquesRealTime
    );
  });
});

// ================================================================
// PASSO 0 — LÓGICA DE RECEPÇÃO E DOWNLOAD
// ================================================================

function _receberDadosProcesso(payload) {
  // Esconde o estado de espera, mostra o painel de seleção
  document.getElementById('statusEproc').classList.add('hidden');
  document.getElementById('painelDocumentos').classList.remove('hidden');
  document.getElementById('btnAnalisarSelecionados').classList.remove('hidden');

  // Renderiza a lista de eventos
  documentSelector.renderizar(payload);
  console.log('[Assistente] Processo carregado:', payload.numeroProcessoFormatado);
}

function _ativarModoManual() {
  // Pula o Passo 0 e vai direto para o Passo 1 no modo manual
  mudarPasso(0, 1);
  document.getElementById('modoManualContainer').classList.remove('hidden');
  document.getElementById('areaCamposAutopreenchidos').classList.add('hidden');
}

async function _baixarEProcessar(anexos) {
  const btnAnalisar = document.getElementById('btnAnalisarSelecionados');
  const progresso   = document.getElementById('progressoDownload');
  const msgProg     = document.getElementById('msgProgresso');
  const barra       = document.getElementById('barraProgresso');

  btnAnalisar.disabled = true;
  progresso.classList.remove('hidden');
  msgProg.textContent = `⏬ Baixando 0/${anexos.length}...`;
  barra.style.width   = '5%';

  // Ouve progresso enviado pelo content_script via background
  const _ouvirProgresso = (msg) => {
    if (msg.tipo === 'PROGRESSO_DOWNLOAD') {
      const pct = Math.round((msg.atual / msg.total) * 80); // até 80% no download
      barra.style.width   = pct + '%';
      msgProg.textContent = `⏬ Baixando ${msg.atual}/${msg.total}: ${msg.nome}`;
    }
  };
  chrome.runtime.onMessage.addListener(_ouvirProgresso);

  try {
    // O download ocorre no content_script (contexto da página autenticada)
    // O background apenas faz ponte via BAIXAR_PDFS → BAIXAR_PDFS_CONTEUDO
    const resposta = await chrome.runtime.sendMessage({
      tipo:   'BAIXAR_PDFS',
      anexos
    });

    chrome.runtime.onMessage.removeListener(_ouvirProgresso);

    if (!resposta.sucesso) {
      throw new Error(resposta.erro || 'Falha desconhecida no download.');
    }

    barra.style.width   = '90%';
    msgProg.textContent = '🤖 Pronto! Cole o JSON da IA para continuar.';

    setTimeout(() => {
      progresso.classList.add('hidden');
      barra.style.width = '0%';
    }, 1500);

    btnAnalisar.disabled = false;

    // Guarda base64 para a Etapa 6 (IA local)
    estadoApp.arquivosBase64 = resposta.arquivos;

    // Avança para Passo 1 em modo manual (fallback até Etapa 6)
    mudarPasso(0, 1);
    document.getElementById('modoManualContainer').classList.remove('hidden');

    const nomesDocs = resposta.arquivos.map(a => a.nome).join(', ');
    document.getElementById('jsonInput').placeholder =
      `✅ ${resposta.arquivos.length} PDF(s) baixados: ${nomesDocs}\n\n` +
      `Cole aqui o JSON gerado pela IA externa.\n` +
      `(A análise automática será ativada na Etapa 6 — IA Local)`;

    console.log(`[Assistente] ${resposta.arquivos.length} PDFs baixados.`);

  } catch (erro) {
    chrome.runtime.onMessage.removeListener(_ouvirProgresso);
    progresso.classList.add('hidden');
    barra.style.width    = '0%';
    btnAnalisar.disabled = false;
    console.error('[Assistente] Erro no download:', erro);
    alert(
      'Erro ao baixar documentos: ' + erro.message +
      '\n\nSe a sessão expirou, faça login novamente no eProc e tente de novo.'
    );
  }
}

// ================================================================
// IA
// ================================================================

async function _verificarIA() {
  const status    = await aiService.verificarDisponibilidade();
  const indicador = document.getElementById('statusIA');
  if (!indicador) return;
  if (status.disponivel) {
    indicador.innerHTML = '🟢 IA Local disponível';
    indicador.style.color = '#28a745';
  } else {
    indicador.innerHTML = '🔴 IA Local indisponível — modo manual ativo';
    indicador.style.color = '#dc3545';
  }
}

// ================================================================
// PREENCHIMENTO DE CAMPOS (inalterado)
// ================================================================

function _carregarDadosNaTela(json) {
  preencherCamposIA(json);
  document.getElementById('modoManualContainer')?.classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos').classList.remove('hidden');
  document.getElementById('jsonInput').classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos')
    .scrollIntoView({ behavior: 'smooth' });
}

function preencherCamposIA(json) {
  if (!json) return;
  const meta        = json.metadados_precatorio  || {};
  const reqCessao   = json.requerimento_cessao   || {};
  const reqDestaque = json.requerimento_destaque || {};
  const cont        = reqDestaque.contrato_honorarios || {};

  const set = (id, valor) => {
    const el = document.getElementById(id);
    if (el && valor) { el.value = valor; el.dispatchEvent(new Event('input')); }
  };

  set('numPrecatorioReal', meta.numero_precatorio);
  set('naturezaPrec',      meta.natureza);
  set('vencimentoPrec',    meta.vencimento);
  set('procOriginario',    meta.processo_judicial_originario);
  set('procSei',           meta.processo_sei);
  set('procEproc',         meta.processo_eproc);
  set('eventoComunicacaoCessao', reqCessao.rastreabilidade_evento?.numero_evento);
  set('eventoInstrumentoCessao', reqCessao.rastreabilidade_evento?.numero_evento);

  const checkDeferido = document.getElementById('deferidoNestaAnalise');
  if (reqDestaque.ha_requerimento) {
    if (checkDeferido && !checkDeferido.checked) {
      checkDeferido.checked = true;
      checkDeferido.dispatchEvent(new Event('change'));
    }
    set('beneficiarioDestaqueNovo', cont.partes?.contratadas?.[0]?.nome);
    const percNum = cont.objeto_e_valores?.estipulacao_honorarios?.percentual_numero;
    if (percNum && percNum > 0) {
      set('percDeferidoAgora', percNum);
    } else {
      const m = cont.objeto_e_valores?.estipulacao_honorarios
        ?.valor_percentual_literal?.match(/\d+/);
      if (m) set('percDeferidoAgora', m[0]);
    }
    set('eventoPedidoDestaque', reqDestaque.rastreabilidade_evento?.numero_evento);
  } else {
    if (checkDeferido?.checked) {
      checkDeferido.checked = false;
      checkDeferido.dispatchEvent(new Event('change'));
    }
  }
  atualizarListaCedentes(json);
}

function atualizarListaCedentes(json) {
  const container = document.getElementById('containerCedentesCheck');
  if (!container) return;
  container.innerHTML = '';

  const inst      = json?.requerimento_cessao?.instrumento_cessao || {};
  const cedentes  = inst.partes?.cedentes || [];
  const cont      = json?.requerimento_destaque?.contrato_honorarios || {};
  const nomeBenNovo  = cont.partes?.contratadas?.[0]?.nome?.trim().toLowerCase() || '';
  const nomeBenPrevio= document.getElementById('beneficiarioDestaquePrevio')
    ?.value.trim().toLowerCase() || '';

  let adicionados = 0;
  cedentes.forEach((cedente, i) => {
    const nomeCed = cedente.nome.trim().toLowerCase();
    if (nomeCed === nomeBenNovo && nomeCed !== nomeBenPrevio && nomeBenNovo !== '') {
      const div = document.createElement('div');
      div.style.cssText = 'font-size:10px;color:#dc3545;margin-bottom:5px;';
      div.innerHTML = `<s>${cedente.nome}</s> <em>(Bloqueado: apenas expectativa de honorários)</em>`;
      container.appendChild(div);
      return;
    }
    const div = document.createElement('div');
    div.className = 'checkbox-group';
    div.style.marginBottom = '5px';
    div.innerHTML = `
      <input type="checkbox" id="cedente_${i}"
        class="check-cedente-legitimo" data-nome="${cedente.nome}" checked>
      <label for="cedente_${i}" style="font-size:14px;">${cedente.nome}</label>`;
    container.appendChild(div);
    adicionados++;
  });

  if (adicionados === 0 && cedentes.length > 0) {
    container.innerHTML = '<span style="color:red;font-size:14px;">Nenhum cedente com crédito válido.</span>';
  } else if (cedentes.length === 0) {
    container.innerHTML = '<span style="color:red;font-size:14px;">Nenhum cedente encontrado.</span>';
  }
}

// ================================================================
// CAPTURA DE INPUTS
// ================================================================

function capturarInputsFinais() {
  const selecionados = Array.from(
    document.querySelectorAll('.check-cedente-legitimo:checked')
  ).map(el => el.getAttribute('data-nome'));

  estadoApp.inputs = {
    numPrecatorioReal:          document.getElementById('numPrecatorioReal')?.value  || '',
    cedentesLegitimos:          selecionados,
    eventoComunicacao:          document.getElementById('eventoComunicacaoCessao')?.value || '',
    eventoInstrumento:          document.getElementById('eventoInstrumentoCessao')?.value || '',
    dataComunicacao:            document.getElementById('dataComunicacaoCessao')?.value   || '',
    existeDestaquePrevio:       document.getElementById('existeDestaquePrevio')?.checked  || false,
    percDestaquePrevio:         parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0,
    eventoDestaquePrevio:       document.getElementById('eventoDestaquePrevio')?.value     || '',
    beneficiarioDestaquePrevio: document.getElementById('beneficiarioDestaquePrevio')?.value || '',
    deferidoNestaAnalise:       document.getElementById('deferidoNestaAnalise')?.checked    || false,
    percDeferidoAgora:          parseFloat(document.getElementById('percDeferidoAgora')?.value) || 0,
    eventoPedidoDestaque:       document.getElementById('eventoPedidoDestaque')?.value  || '',
    dataPedidoDestaque:         document.getElementById('dataPedidoDestaque')?.value    || '',
    beneficiarioDestaqueNovo:   document.getElementById('beneficiarioDestaqueNovo')?.value || '',
    opcaoDivergencia:           document.getElementById('opcaoDivergencia')?.value       || '1',
    inferiorEquivaleTotalidade: document.getElementById('inferiorEquivaleTotalidade')?.checked || false,
    perdaObjetoCertificada:     document.getElementById('certificarPerdaObjeto')?.checked      || false
  };
}

// ================================================================
// UTILITÁRIOS
// ================================================================

function inicializarLocalStorage() {
  const inputs = document.querySelectorAll(
    'input:not(#jsonInput), textarea:not(#jsonInput), select'
  );
  inputs.forEach(el => {
    const salvo = localStorage.getItem(el.id);
    if (salvo !== null) {
      if (el.type === 'checkbox') el.checked = (salvo === 'true');
      else el.value = salvo;
    }
    const ev = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(ev, () =>
      localStorage.setItem(el.id, el.type === 'checkbox' ? el.checked : el.value)
    );
  });
}

function mudarPasso(sai, entra) {
  const elSai   = document.getElementById(`passo${sai}`);
  const elEntra = document.getElementById(`passo${entra}`);
  if (elSai)   elSai.classList.add('hidden');
  if (elEntra) elEntra.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function configurarCopia(btnId, areaId, label) {
  document.getElementById(btnId)?.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById(areaId).value);
    this.innerText = '✓ Copiado!';
    setTimeout(() => { this.innerText = label; }, 2000);
  });
}

// ================================================================
// VALIDAÇÃO EM TEMPO REAL (inalterada)
// ================================================================

function validarDestaquesRealTime() {
  const painel      = document.getElementById('painelAlertaDestaque');
  const displayMsg  = document.getElementById('msgAlertaUnificada');
  const areaCheck   = document.getElementById('areaCheckPerda');
  const areaDecisao = document.getElementById('areaDecisaoDivergencia');
  const checkPerda  = document.getElementById('certificarPerdaObjeto');

  if (!painel || !estadoApp.jsonBruto) return;

  const reqCessao = estadoApp.jsonBruto.requerimento_cessao || {};
  const inst      = reqCessao.instrumento_cessao || {};
  const ressalva  = parseFloat(inst.ressalva_honorarios?.percentual_contratuais) || 0;

  const previoPerc  = parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0;
  const novoPerc    = parseFloat(document.getElementById('percDeferidoAgora')?.value)  || 0;
  const previoNome  = document.getElementById('beneficiarioDestaquePrevio')?.value.trim().toLowerCase() || '';
  const novoNome    = document.getElementById('beneficiarioDestaqueNovo')?.value.trim().toLowerCase()   || '';
  const perdaCert   = checkPerda?.checked || false;
  const ehDuplicado = (previoPerc > 0 && novoPerc > 0 && previoPerc === novoPerc &&
                       previoNome === novoNome && previoNome !== '');
  const novoEfetivo = perdaCert ? 0 : novoPerc;
  const soma        = previoPerc + novoEfetivo;
  const erroMat     = (ressalva > 0 && soma !== ressalva);

  let msgs = [], mostrarCheck = false, mostrarSelect = false, tipoPainel = 'escondido';

  if (ehDuplicado) {
    mostrarCheck = true;
    if (!perdaCert) {
      msgs.push('⚠️ <strong>AÇÃO NECESSÁRIA:</strong> Pedido idêntico ao histórico. Certifique a perda de objeto.');
      tipoPainel = 'warning';
    } else {
      msgs.push('✅ <strong>PERDA DE OBJETO CERTIFICADA.</strong> Valor novo desconsiderado da soma.');
      tipoPainel = 'success';
    }
  }

  if (erroMat) {
    if (!ehDuplicado || perdaCert) {
      msgs.push(`❌ <strong>DIVERGÊNCIA:</strong> Soma (${soma}%) ≠ Ressalva (${ressalva}%).`);
      mostrarSelect = true;
    }
    tipoPainel = 'error';
  }

  if (msgs.length > 0) {
    painel.classList.remove('hidden');
    displayMsg.innerHTML = msgs.join('<br><br>');
    areaCheck.classList.toggle('hidden', !mostrarCheck);
    areaDecisao.classList.toggle('hidden', !mostrarSelect);
    const estilos = {
      error:   { bg: '#fff5f5', border: '#dc3545', color: '#721c24' },
      warning: { bg: '#fffbef', border: '#ffc107', color: '#856404' },
      success: { bg: '#f4fff6', border: '#28a745', color: '#155724' }
    };
    const e = estilos[tipoPainel] || estilos.warning;
    painel.style.backgroundColor = e.bg;
    painel.style.borderColor     = e.border;
    displayMsg.style.color       = e.color;
  } else {
    painel.classList.add('hidden');
  }
}
