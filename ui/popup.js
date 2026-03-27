/**
 * ui/popup.js
 *
 * CORREÇÃO: Removidas as pontes de compatibilidade que redeclaravam
 * templateLoader, ruleEngine e templateRenderer — esses objetos já são
 * declarados pelos módulos core e estão disponíveis globalmente.
 *
 * Ordem de carregamento no HTML (deve ser mantida):
 *   core/pdfHandler.js
 *   core/aiService.js
 *   core/templateLoader.js   ← declara `templateLoader`
 *   core/ruleEngine.js       ← declara `processarDecisoes`
 *   core/templateRenderer.js ← declara `templateRenderer`
 *   templates/cessao-credito/rules.js
 *   templates/cessao-credito/renderer.js
 *   ui/components/documentSelector.js
 *   ui/popup.js              ← apenas consome os módulos acima
 */

// ================================================================
// ESTADO GLOBAL
// ================================================================

let estadoApp = {
  jsonBruto: null,
  inputs: null,
  templateId: 'cessao-credito',
  dadosPrecatorio: ''
};

// ================================================================
// VALIDAÇÃO EM TEMPO REAL
// ================================================================

function validarDestaquesRealTime() {
  const painel = document.getElementById('painelAlertaDestaque');
  const displayMsg = document.getElementById('msgAlertaUnificada');
  const areaCheck = document.getElementById('areaCheckPerda');
  const areaDecisao = document.getElementById('areaDecisaoDivergencia');
  const checkPerda = document.getElementById('certificarPerdaObjeto');

  if (!painel || !estadoApp.jsonBruto) return;

  const inst = estadoApp.jsonBruto.requerimento_cessao?.instrumento_cessao || {};
  const ressalva = parseFloat(inst.ressalva_honorarios?.percentual_contratuais) || 0;

  const previoPerc = parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0;
  const novoPerc = parseFloat(document.getElementById('percDeferidoAgora')?.value) || 0;
  const previoNome = document.getElementById('beneficiarioDestaquePrevio')?.value.trim().toLowerCase() || '';
  const novoNome = document.getElementById('beneficiarioDestaqueNovo')?.value.trim().toLowerCase() || '';
  const perdaCert = checkPerda?.checked || false;

  const ehDuplicado = (
    previoPerc > 0 && novoPerc > 0 &&
    previoPerc === novoPerc &&
    previoNome !== '' && previoNome === novoNome
  );
  const novoEfetivo = perdaCert ? 0 : novoPerc;
  const soma = previoPerc + novoEfetivo;
  const erroMat = ressalva > 0 && soma !== ressalva;

  let msgs = [], mostrarCheck = false, mostrarSelect = false, tipoPainel = '';

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
      error: { bg: '#fff5f5', border: '#dc3545', color: '#721c24' },
      warning: { bg: '#fffbef', border: '#ffc107', color: '#856404' },
      success: { bg: '#f4fff6', border: '#28a745', color: '#155724' }
    };
    const e = estilos[tipoPainel] || estilos.warning;
    painel.style.backgroundColor = e.bg;
    painel.style.borderColor = e.border;
    displayMsg.style.color = e.color;
  } else {
    painel.classList.add('hidden');
  }
}

// ================================================================
// INICIALIZAÇÃO
// ================================================================

document.addEventListener('DOMContentLoaded', function () {
  console.log('[Assistente] Iniciado. Template:', estadoApp.templateId);

  inicializarLocalStorage();

  const toggleDiv = (checkId, divId) => {
    const check = document.getElementById(checkId);
    const div = document.getElementById(divId);
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

  // ── Passo 0: ouvir dados do eProc ──────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.tipo === 'DADOS_PROCESSO') _receberDadosProcesso(msg.payload);
  });

  chrome.storage.session.get('processoDetectado').then(resultado => {
    if (resultado.processoDetectado) {
      _receberDadosProcesso(resultado.processoDetectado);
      chrome.storage.session.remove('processoDetectado');
    }
  });

  document.getElementById('btnUsarModoManual')
    ?.addEventListener('click', _ativarModoManual);

  document.getElementById('btnAnalisarSelecionados')
    ?.addEventListener('click', async () => {
      const anexos = documentSelector.getAnexosSelecionados();
      if (anexos.length === 0) {
        alert('Selecione pelo menos um documento para analisar.');
        return;
      }
      await _baixarEProcessar(anexos);
    });

  // ── Passo 1 ────────────────────────────────────────────────────

  document.getElementById('btnSalvarJSON')
    ?.addEventListener('click', function () {
      const rawInput = document.getElementById('jsonInput').value;
      try {
        estadoApp.jsonBruto = pdfHandler.extrairJSON(rawInput);
        _carregarDadosNaTela(estadoApp.jsonBruto);
      } catch (e) {
        alert('Erro ao ler JSON.\nErro: ' + e.message);
      }
    });

  document.getElementById('btnReiniciar')
    ?.addEventListener('click', function () {
      if (confirm('Deseja limpar todos os dados e reiniciar?')) {
        localStorage.clear();
        window.location.reload();
      }
    });

  document.getElementById('btnGerarCertidao')
    ?.addEventListener('click', function () {
      if (!estadoApp.jsonBruto) {
        alert('Por favor, carregue o JSON primeiro.');
        return;
      }
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

  // ── Passo 2 → 3 ────────────────────────────────────────────────

  document.getElementById('btnConfirmarCertidao')
    ?.addEventListener('click', function () {
      try {
        const resultado = processarDecisoes(
          estadoApp.jsonBruto, estadoApp.inputs
        );
        const htmlMinuta = templateRenderer.renderizarMinuta(
          estadoApp.jsonBruto, estadoApp.inputs, resultado.textos, estadoApp.templateId
        );
        const htmlTabela = templateRenderer.renderizarTabela(
          resultado.tabela, estadoApp.templateId
        );
        document.getElementById('previaMinuta').innerHTML = htmlMinuta;
        document.getElementById('previaTabela').innerHTML = htmlTabela;
        document.getElementById('outputMinuta').value = htmlMinuta;
        document.getElementById('outputTabela').value = htmlTabela;
        mudarPasso(2, 3);
      } catch (erro) {
        console.error('[Assistente] Erro ao gerar minuta:', erro);
        alert('Erro ao processar regras: ' + erro.message);
      }
    });

  document.getElementById('btnVoltarPasso2')
    ?.addEventListener('click', () => mudarPasso(3, 2));
  document.getElementById('btnVoltarPasso1')
    ?.addEventListener('click', () => mudarPasso(2, 1));

  configurarCopia('btnCopiarMinuta', 'outputMinuta', 'Só Minuta');
  configurarCopia('btnCopiarTabela', 'outputTabela', 'Só Tabela');

  document.getElementById('btnCopiarTudo')
    ?.addEventListener('click', function () {
      const texto =
        document.getElementById('outputMinuta').value + '\n\n' +
        document.getElementById('outputTabela').value;
      navigator.clipboard.writeText(texto);
      this.innerText = '✓ Tudo Copiado!';
      this.style.backgroundColor = '#28a745';
      setTimeout(() => {
        this.innerText = '📋 Copiar Tudo (Minuta + Tabela)';
        this.style.backgroundColor = '#17a2b8';
      }, 2000);
    });

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
// PASSO 0 — RECEPÇÃO E DOWNLOAD
// ================================================================

function _receberDadosProcesso(payload) {
  document.getElementById('statusEproc')?.classList.add('hidden');
  document.getElementById('painelDocumentos')?.classList.remove('hidden');
  document.getElementById('btnAnalisarSelecionados')?.classList.remove('hidden');

  estadoApp.dadosPrecatorio = payload.dadosPrecatorio || '';

  documentSelector.renderizar(payload);
  console.log('[Assistente] Processo carregado:', payload.numeroProcessoFormatado);
}

function _ativarModoManual() {
  mudarPasso(0, 1);
  document.getElementById('modoManualContainer')?.classList.remove('hidden');
  document.getElementById('areaCamposAutopreenchidos')?.classList.add('hidden');
}

async function _baixarEProcessar(anexos) {
  const btnAnalisar = document.getElementById('btnAnalisarSelecionados');
  const progresso = document.getElementById('progressoDownload');
  const msgProg = document.getElementById('msgProgresso');
  const barra = document.getElementById('barraProgresso');

  btnAnalisar.disabled = true;
  progresso.classList.remove('hidden');
  msgProg.textContent = `⏬ Baixando 0/${anexos.length}...`;
  barra.style.width = '5%';

  const _ouvirProgresso = (msg) => {
    if (msg.tipo === 'PROGRESSO_DOWNLOAD') {
      const pct = Math.round((msg.atual / msg.total) * 80);
      barra.style.width = pct + '%';
      msgProg.textContent = `⏬ Baixando ${msg.atual}/${msg.total}: ${msg.nome}`;
    }
  };
  chrome.runtime.onMessage.addListener(_ouvirProgresso);

  try {
    const resposta = await chrome.runtime.sendMessage({
      tipo: 'BAIXAR_PDFS',
      anexos
    });

    chrome.runtime.onMessage.removeListener(_ouvirProgresso);

    if (!resposta.sucesso) {
      throw new Error(resposta.erro || 'Falha desconhecida no download.');
    }

    estadoApp.arquivosBase64 = resposta.arquivos;

    msgProg.textContent = '🧠 Lendo PDFs...';
    barra.style.width = '85%';

    try {
      const textosExtraidos = [];
      for (const arq of resposta.arquivos) {
        msgProg.textContent = `📄 Lendo texto: ${arq.nome}...`;
        const texto = await pdfHandler.extrairTexto(arq.base64);
        if (texto) textosExtraidos.push(texto);
      }

      if (textosExtraidos.length === 0) {
        throw new Error('Nenhum texto pôde ser extraído dos PDFs selecionados.');
      }

      msgProg.textContent = '🤖 Analisando com IA local (Gemini Nano)...';
      barra.style.width = '90%';

      const template = await templateLoader.carregar(estadoApp.templateId);

      const dadosPrecatorio =
        estadoApp.dadosPrecatorio ||
        document.getElementById('dadosPrecatorioManual')?.value.trim() ||
        '';

      const onProgressoModelo = (pct) => {
        msgProg.textContent = `⬇️ Baixando modelo Gemini Nano: ${pct}%...`;
      };
 
      const onInferencia = (charsGerados) => {
        msgProg.textContent = `🧠 Analisando documentos... (${charsGerados} chars)`;
        // Barra de progresso: de 90% até 98% proporcional ao JSON gerado
        const progEstimado = Math.min(98, 90 + (charsGerados / 3000) * 8);
        barra.style.width = progEstimado + '%';
      };
 
      const resultadoIA = await aiService.extrair({
        textos:          textosExtraidos,
        promptTemplate:  template.prompt,
        dadosPrecatorio,
        onProgresso:     onProgressoModelo,
        onInferencia
      });

    } catch (erroIA) {
      console.warn('[Assistente] Falha na IA, ativando modo manual:', erroIA.message);
      setTimeout(() => {
        progresso.classList.add('hidden');
        barra.style.width = '0%';
      }, 800);
      btnAnalisar.disabled = false;

      mudarPasso(0, 1);
      document.getElementById('modoManualContainer')?.classList.remove('hidden');

      const nomesDocs = resposta.arquivos.map(a => a.nome).join(', ');
      document.getElementById('jsonInput').placeholder =
        `✅ ${resposta.arquivos.length} PDF(s) baixado(s): ${nomesDocs}\n\n` +
        `⚠️ IA local indisponível ou falhou: ${erroIA.message}\n\n` +
        `Cole aqui o JSON gerado por uma IA externa para continuar.`;
    }

  } catch (erro) {
    chrome.runtime.onMessage.removeListener(_ouvirProgresso);
    progresso.classList.add('hidden');
    barra.style.width = '0%';
    btnAnalisar.disabled = false;
    console.error('[Assistente] Erro no download:', erro);
    alert('Erro ao baixar documentos: ' + erro.message);
  }
}

// ================================================================
// IA — INDICADOR DE STATUS
// ================================================================

async function _verificarIA() {
  const status = await aiService.verificarDisponibilidade();
  const indicador = document.getElementById('statusIA');
  if (!indicador) return;

  if (status.disponivel) {
    indicador.textContent = '🟢 IA local disponível (Gemini Nano)';
    indicador.style.color = '#28a745';
    return;
  }

  const motivos = {
    'available': 'disponível',
    'downloadable': 'modelo não baixado — será iniciado ao analisar',
    'downloading': 'modelo em download, aguarde e tente novamente',
    'unavailable': 'indisponível neste dispositivo',
    'readily': 'disponível',
    'after-download': 'modelo em download, tente novamente em breve',
    'no': 'indisponível neste dispositivo',
    'api_nao_suportada': 'Chrome sem suporte — use Chrome 138+ com as flags habilitadas',
    'erro_verificacao': 'erro ao verificar disponibilidade'
  };

  const detalhe = motivos[status.motivo] || status.motivo;
  indicador.textContent = `🔴 IA local indisponível — ${detalhe}`;
  indicador.style.color = '#dc3545';
}

// ================================================================
// PREENCHIMENTO AUTOMÁTICO DOS CAMPOS (Passo 1)
// ================================================================

/**
 * Recebe o JSON bruto da IA e preenche os campos do formulário
 * do Passo 1 automaticamente.
 *
 * Mapeamento:
 *   json.metadados_precatorio  → Seção A (readonly)
 *   json.requerimento_destaque → Seção C (destaque novo, se houver)
 *   json.requerimento_cessao.instrumento_cessao.partes.cedentes → Seção D
 *
 * @param {Object} json - JSON extraído pela IA (estadoApp.jsonBruto)
 */
function preencherCamposIA(json) {
  if (!json) return;

  // ── A. Identificação do Precatório (readonly) ──────────────────
  const meta = json.metadados_precatorio || {};

  _setVal('numPrecatorioReal', meta.numero_precatorio);
  _setVal('naturezaPrec', meta.natureza);
  _setVal('vencimentoPrec', meta.vencimento);
  _setVal('procOriginario', meta.processo_judicial_originario);
  _setVal('procSei', meta.processo_sei);
  _setVal('procEproc', meta.processo_eproc);

  // ── C. Destaque Novo (se a IA detectou requerimento) ───────────
  const reqDestaque = json.requerimento_destaque || {};
  const contrato = reqDestaque.contrato_honorarios || {};

  if (reqDestaque.ha_requerimento === true) {
    const chkNovo = document.getElementById('deferidoNestaAnalise');
    if (chkNovo && !chkNovo.checked) {
      chkNovo.checked = true;
      chkNovo.dispatchEvent(new Event('change'));
    }

    _setVal('beneficiarioDestaqueNovo', reqDestaque.beneficiario || contrato.contratante);
    _setVal('percDeferidoAgora', contrato.percentual_contratuais);
  }

  // ── D. Legitimidade dos Cedentes ───────────────────────────────
  atualizarListaCedentes(json);

  console.log('[Assistente] Campos do Passo 1 preenchidos pela IA.');
}

// ================================================================
// LISTA DE CEDENTES (Seção D — checkboxes)
// ================================================================

/**
 * Renderiza os checkboxes de cedentes no container #containerCedentesCheck.
 * Cada cedente vem de json.requerimento_cessao.instrumento_cessao.partes.cedentes.
 *
 * Regra: marca como checked se e_parte_precatorio === true.
 *
 * @param {Object} json - JSON bruto da IA
 */
function atualizarListaCedentes(json) {
  const container = document.getElementById('containerCedentesCheck');
  if (!container) return;

  const inst = json?.requerimento_cessao?.instrumento_cessao || {};
  const cedentes = inst.partes?.cedentes || [];

  if (cedentes.length === 0) {
    container.innerHTML =
      '<span style="color:#999;font-size:14px;">Nenhum cedente identificado pela IA.</span>';
    return;
  }

  let html = '';
  cedentes.forEach((c, i) => {
    const nome = c.nome || `Cedente ${i + 1}`;
    const doc = c.numero_documento
      ? ` (${c.tipo_documento || 'Doc'}: ${c.numero_documento})`
      : '';
    const checked = c.e_parte_precatorio ? 'checked' : '';

    html += `
      <label style="display:flex;align-items:center;gap:8px;
        font-size:13px;cursor:pointer;padding:3px 0;">
        <input type="checkbox" class="check-cedente"
          data-nome="${nome}"
          ${checked}
          style="width:14px;height:14px;margin:0;cursor:pointer;flex-shrink:0;">
        <span>${nome}${doc}</span>
      </label>`;
  });

  container.innerHTML = html;
}

// ================================================================
// UTILITÁRIO: setar valor + disparar evento para localStorage
// ================================================================

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (!el || val === undefined || val === null || val === '') return;
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ================================================================
// CARREGAMENTO DE DADOS NA TELA
// ================================================================

function _carregarDadosNaTela(json) {
  preencherCamposIA(json);
  document.getElementById('modoManualContainer')?.classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos')?.classList.remove('hidden');
  document.getElementById('jsonInput')?.classList.add('hidden');
  document.getElementById('areaCamposAutopreenchidos')
    ?.scrollIntoView({ behavior: 'smooth' });
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
  document.getElementById(`passo${sai}`)?.classList.add('hidden');
  document.getElementById(`passo${entra}`)?.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function configurarCopia(btnId, areaId, label) {
  document.getElementById(btnId)?.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById(areaId).value);
    this.innerText = `✓ Copiado!`;
    this.style.backgroundColor = '#28a745';
    setTimeout(() => {
      this.innerText = label;
      this.style.backgroundColor = '';
    }, 2000);
  });
}

function capturarInputsFinais() {
  // Coleta os nomes dos cedentes marcados como legítimos
  const cedentesLegitimos = [];
  document.querySelectorAll('.check-cedente:checked').forEach(chk => {
    cedentesLegitimos.push(chk.dataset.nome);
  });

  estadoApp.inputs = {
    eventoComunicacao: document.getElementById('eventoComunicacaoCessao')?.value || '',
    eventoInstrumento: document.getElementById('eventoInstrumentoCessao')?.value || '',
    dataComunicacao: document.getElementById('dataComunicacaoCessao')?.value || '',
    existeDestaquePrevio: document.getElementById('existeDestaquePrevio')?.checked || false,
    percDestaquePrevio: parseFloat(document.getElementById('percDestaquePrevio')?.value) || 0,
    eventoDestaquePrevio: document.getElementById('eventoDestaquePrevio')?.value || '',
    beneficiarioDestaquePrevio: document.getElementById('beneficiarioDestaquePrevio')?.value || '',
    deferidoNestaAnalise: document.getElementById('deferidoNestaAnalise')?.checked || false,
    percDeferidoAgora: parseFloat(document.getElementById('percDeferidoAgora')?.value) || 0,
    eventoPedidoDestaque: document.getElementById('eventoPedidoDestaque')?.value || '',
    dataPedidoDestaque: document.getElementById('dataPedidoDestaque')?.value || '',
    beneficiarioDestaqueNovo: document.getElementById('beneficiarioDestaqueNovo')?.value || '',
    opcaoDivergencia: document.getElementById('opcaoDivergencia')?.value || 'INTIMAR',
    inferiorEquivaleTotalidade: document.getElementById('inferiorEquivaleTotalidade')?.checked || false,
    perdaObjetoCertificada: document.getElementById('certificarPerdaObjeto')?.checked || false,
    // ↓ CAMPOS NOVOS (necessários para rules.js e renderer.js)
    cedentesLegitimos,
    dataComunicacao: document.getElementById('dataComunicacaoCessao')?.value || ''
  };
}