/**
 * templates/cessao-credito/renderer.js
 * Renderizadores HTML específicos para cessão de crédito.
 * Migrado de renderizarCertidao.js + gerarMinutaHTML.js + gerarTabelaNSCHTML.js.
 *
 * CONTRATO: Registra window.templateRenderer_cessao_credito com:
 *   .certidao(dadosIA, inputs) → HTML
 *   .minuta(dadosIA, inputs, textos) → HTML
 *   .tabela(dados) → HTML
 */

// ── Helpers compartilhados ─────────────────────────────────────────────────
function _criarLinha(aspecto, analise, loc) {
  return `<tr>
    <td style="font-weight:bold;border:1px solid #ccc;padding:8px;word-wrap:break-word;background:#fdfdfd;">${aspecto}</td>
    <td style="border:1px solid #ccc;padding:8px;word-wrap:break-word;line-height:1.5;">${analise || '-'}</td>
    <td style="font-size:13px;color:#555;border:1px solid #ccc;padding:8px;word-wrap:break-word;font-style:italic;">${loc || 'N/I'}</td>
  </tr>`;
}

function _checkIcon(val) {
  return val
    ? '<span style="color:green;font-weight:bold;">✅ SIM</span>'
    : '<span style="color:red;font-weight:bold;">❌ NÃO</span>';
}

function _renderizarParte(p) {
  const id = p.numero_documento
    ? `${p.tipo_documento || 'Doc'}: ${p.numero_documento}`
    : (p.oab || p.oab_uf ? `OAB: ${p.oab || p.oab_uf}` : 'N/I');
  return `<strong>${p.nome || '-'}</strong> (${id})`;
}

function _limparNome(nome) {
  if (!nome) return '-';
  return nome.replace(/^[\d.\-]+[_\-]?/, '');
}

// ── Certidão de Conferência ────────────────────────────────────────────────
function _certidao(json, inputs) {
  const meta       = json?.metadados_precatorio || {};
  const reqCessao  = json?.requerimento_cessao  || {};
  const inst       = reqCessao.instrumento_cessao || {};
  const reqDestaque= json?.requerimento_destaque || {};
  const cont       = reqDestaque.contrato_honorarios || {};

  let html = `<table style="width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px;">
    <tr style="background:#343a40;color:white;">
      <th style="width:25%;padding:8px;border:1px solid #ccc;">Aspecto</th>
      <th style="width:55%;padding:8px;border:1px solid #ccc;">Análise IA / Dados Extraídos</th>
      <th style="width:20%;padding:8px;border:1px solid #ccc;">Localização</th>
    </tr>`;

  // DADOS DO PRECATÓRIO
  html += `<tr><td colspan="3" style="background:#e9ecef;font-weight:bold;padding:8px;border:1px solid #ccc;text-align:center;">DADOS DO PRECATÓRIO</td></tr>`;
  html += _criarLinha("Identificação",
    `<em>Nº (GV):</em> <strong>${meta.numero_precatorio || '-'}</strong><br><em>Natureza:</em> ${meta.natureza || '-'}<br><em>Vencimento:</em> ${meta.vencimento || '-'}`,
    "SGP/TJMG");
  html += _criarLinha("Devedor", meta.devedor || '-', "SGP/TJMG");
  html += _criarLinha("Processos",
    `<strong>Originário:</strong> ${meta.processo_judicial_originario || '-'}<br><strong>SEI:</strong> ${meta.processo_sei || '-'}<br><strong>Eproc:</strong> ${meta.processo_eproc || '-'}`,
    "SGP/TJMG");

  const infoDestaquePrevio = inputs.existeDestaquePrevio
    ? `<strong style="color:#0056b3;">SIM</strong><br><em>%:</em> ${inputs.percDestaquePrevio || 0}%<br><em>Beneficiário:</em> ${inputs.beneficiarioDestaquePrevio || 'N/I'}<br><em>Evento:</em> ${inputs.eventoDestaquePrevio || 'N/I'}`
    : `<strong>NÃO</strong>`;
  html += _criarLinha("Destaque Prévio", infoDestaquePrevio, "Painel de Inputs");

  // REQUERIMENTO DE CESSÃO
  html += `<tr><td colspan="3" style="background:#d1ecf1;font-weight:bold;padding:8px;border:1px solid #ccc;text-align:center;">REQUERIMENTO DE CESSÃO</td></tr>`;
  html += _criarLinha("Eventos",
    `<strong>Comunicação:</strong> Ev. ${inputs.eventoComunicacao || '-'}<br><strong>Instrumento:</strong> Ev. ${inputs.eventoInstrumento || '-'}<br><strong>Data:</strong> ${inputs.dataComunicacao || '-'}`,
    "Painel de Inputs");

  const chk = reqCessao.checklist_documentos || {};
  const listaChk = `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8;">
    <li><strong>Petição:</strong> ${_checkIcon(chk.peticao_comunicacao_cessao?.presente)} <em>(${_limparNome(chk.peticao_comunicacao_cessao?.nome_arquivo)})</em></li>
    <li><strong>Instrumento:</strong> ${_checkIcon(chk.instrumento_cessao?.presente)} <em>(${_limparNome(chk.instrumento_cessao?.nome_arquivo)})</em></li>
    <li><strong>Docs Cessionário:</strong> ${_checkIcon(chk.documentos_cessionario?.presente)}</li>
    <li><strong>Rep. Cessionário:</strong> ${_checkIcon(chk.documentos_representacao_cessionario?.presente)}</li>
    <li><strong>Procurações:</strong> ${_checkIcon(chk.procuracoes?.presente)}</li>
    <li><strong>Renúncia Superprefer.:</strong> ${_checkIcon(chk.termo_renuncia_superpreferencia?.presente)}</li>
    <li><strong>Quitação Honorários:</strong> ${_checkIcon(chk.declaracao_quitacao_honorarios?.presente)}</li>
  </ul><hr style="margin:8px 0;border:0;border-top:1px dashed #ccc;">
  <em>Parecer:</em> ${chk.analise_geral || '-'}`;
  html += _criarLinha("Checklist Documentos", listaChk, "Visão Geral do Anexo");

  // PARTES
  html += `<tr><td colspan="3" style="background:#d1ecf1;font-weight:bold;padding:8px;border:1px solid #ccc;text-align:center;">PARTES</td></tr>`;

  const cedentes = (inst.partes?.cedentes || []).map(c =>
    `${_renderizarParte(c)}<br><em>Parte no Prec.:</em> ${c.e_parte_precatorio ? 'SIM' : 'NÃO'}<br><em>Análise:</em> ${c.analise || '-'}`
  ).join("<br><hr style='margin:5px 0;border:0;border-top:1px dashed #ccc;'><br>") || "Nenhum identificado";
  html += _criarLinha("Cedente(s)", cedentes, inst.partes?.cedentes?.[0]?.localizacao);

  const cessionarios = (inst.partes?.cessionarios || []).map(c =>
    `${_renderizarParte(c)}<br><em>Análise:</em> ${c.analise || '-'}`
  ).join("<br><hr style='margin:5px 0;border:0;border-top:1px dashed #ccc;'><br>") || "Nenhum identificado";
  html += _criarLinha("Cessionário(s)", cessionarios, inst.partes?.cessionarios?.[0]?.localizacao);

  // OBJETO ECONÔMICO
  html += `<tr><td colspan="3" style="background:#d4edda;font-weight:bold;padding:8px;border:1px solid #ccc;text-align:center;">OBJETO ECONÔMICO E EFEITOS JURÍDICOS</td></tr>`;

  const objEcon = inst.objeto_economico || {};
  html += _criarLinha("Percentual Cedido",
    `<strong>${objEcon.percentual_instrumento?.percentual_numero || 0}%</strong><br><em>Literal:</em> ${objEcon.percentual_instrumento?.texto_literal || 'N/I'}<br><em>Análise:</em> ${objEcon.percentual_instrumento?.analise || '-'}`,
    objEcon.percentual_instrumento?.localizacao);

  html += _criarLinha("Base de Cálculo",
    `<em>Classificação:</em> <strong>${objEcon.base_calculo?.classificacao || 'BASE_INDEFINIDA'}</strong><br><em>Análise:</em> ${objEcon.base_calculo?.analise || 'N/I'}`,
    objEcon.base_calculo?.localizacao);

  html += _criarLinha("Superpreferência",
    `<em>Status:</em> <strong>${inst.superpreferencia?.status || 'sem_previsao'}</strong><br><em>Análise:</em> ${inst.superpreferencia?.analise || 'N/I'}`,
    inst.superpreferencia?.localizacao);

  const ressalva = inst.ressalva_honorarios || {};
  const ressalvaNum = parseFloat(ressalva.percentual_contratuais) || 0;
  const percPrevio  = parseFloat(inputs.percDestaquePrevio) || 0;
  const percNovo    = inputs.perdaObjetoCertificada ? 0 : (parseFloat(inputs.percDeferidoAgora) || 0);
  const soma        = percPrevio + percNovo;

  let infoCoer = "";
  let estiloCoer = "color:green;";
  if (inputs.perdaObjetoCertificada) {
    infoCoer = `✅ <strong>SOMA AJUSTADA:</strong> Pedido novo ignorado por perda de objeto.<br><em>Cálculo:</em> Histórico (${percPrevio}%) = Ressalva (${ressalvaNum}%)`;
  } else if (ressalvaNum === soma) {
    infoCoer = `✅ <strong>COERENTE:</strong> Ressalva (${ressalvaNum}%) = Soma (${soma}%)`;
  } else {
    estiloCoer = "color:red;font-weight:bold;";
    infoCoer = `❌ <strong>DIVERGENTE:</strong><br>Ressalva: ${ressalvaNum}%<br>Soma: ${soma}% (Histórico ${percPrevio}% + Novo ${percNovo}%)<br><strong>DECISÃO:</strong> ${inputs.opcaoDivergencia || 'N/I'}`;
  }

  html += _criarLinha("Ressalva de Honorários",
    `<em>Tipo:</em> <strong>${ressalva.tipo || 'sem_previsao'}</strong><br><em>%:</em> ${ressalvaNum}%`,
    ressalva.localizacao);
  html += _criarLinha("Coerência (Destaques × Ressalva)",
    `<span style="${estiloCoer}">${infoCoer}</span>`, "Motor de Regras");

  html += _criarLinha("% NSC", "<strong>Aguardando confirmação no Passo 3...</strong>", "Passo 3");

  return html + `</table>`;
}

// ── Minuta do Despacho ─────────────────────────────────────────────────────
function _minuta(extracaoIA, inputsUsuario, textos) {
  const reqCessao    = extracaoIA?.requerimento_cessao || {};
  const inst         = reqCessao.instrumento_cessao || extracaoIA?.instrumento_cessao || {};
  const cessionarios = inst.partes?.cessionarios || [];
  const nomesCedentes= inputsUsuario.cedentesLegitimos || [];

  const cedente    = nomesCedentes.join(", ").replace(/, ([^,]*)$/, ' e $1') || "[CEDENTE]";
  const cessionario= cessionarios.map(c => c.nome).join(", ").replace(/, ([^,]*)$/, ' e $1') || "[CESSIONÁRIO]";

  const eventoCom = inputsUsuario.eventoComunicacao || "[EVENTO]";
  const prefixoCom = (eventoCom.includes(",") || eventoCom.includes(" e ") || eventoCom.includes("-"))
    ? "aos eventos" : "ao evento";

  const html = `
<p class="paragrafoPadrao">Trata-se, ${prefixoCom} ${eventoCom}, de comunicação de cessão dos direitos creditórios de <strong>${cedente}</strong> em favor de <strong>${cessionario}</strong>.</p>
<p class="paragrafoPadrao">${textos.basePerc || ""}</p>
<p class="paragrafoPadrao">${textos.ressalva || ""}</p>
<p class="paragrafoPadrao">${textos.superpreferencia || ""}</p>
<p class="paragrafoPadrao">${textos.reqDestaque || ""}</p>
<p class="paragrafoPadrao">É o relatório. Decido.</p>
<p class="paragrafoPadrao">${textos.decisaoDestaque || ""}</p>
<p class="paragrafoPadrao">Dê-se ciência aos procuradores do(s) beneficiário(s) (originário/cedente), bem como do devedor pelo prazo de 2 (dois) dias corridos para eventuais impugnações, nos termos do art. 80, da Resolução n.° 303/2019 do CNJ.</p>
<p class="paragrafoPadrao">Decorrido o prazo sem impugnação dos interessados, <strong>REGISTRE(M)-SE ${cessionario}</strong> como beneficiário(s) cessionário(s) dos direitos previstos na cessão, com o devido cadastramento de seu(s) patrono(s).</p>
<p class="paragrafoPadrao">A ordem cronológica do precatório fica mantida e o(s) cessionário(s) não faz(em) jus às preferências do § 2º do art. 100 da CR, estando sujeito(s) ao disposto no § 2º do art. 42 da Resolução n.° 303/2019 do CNJ.</p>
<p class="paragrafoPadrao">Esta decisão servirá como ofício para conhecimento do juízo da execução, conforme art. 45, § 1º, da referida Resolução.</p>
<p class="paragrafoPadrao">Belo Horizonte, data da assinatura eletrônica.</p>`;

  return html
    .replace(/<p class="paragrafoPadrao">\s*\(omitido\)\s*<\/p>/gi, "")
    .replace(/<p class="paragrafoPadrao">\s*<\/p>/gi, "")
    .trim();
}

// ── Tabela NSC ─────────────────────────────────────────────────────────────
function _tabela(dados) {
  let linhasHTML = "";
  (dados.linhasNSC || []).forEach(row => {
    linhasHTML += `<tr>
      <td style="border:1px solid #000;padding:5px;">${row.data}</td>
      <td style="border:1px solid #000;padding:5px;">${row.tipo}</td>
      <td style="border:1px solid #000;padding:5px;">${row.percentual}%</td>
      <td style="border:1px solid #000;padding:5px;">${row.de}</td>
      <td style="border:1px solid #000;padding:5px;">${row.para}</td>
      <td style="border:1px solid #000;padding:5px;">${row.evento}</td>
      <td style="border:1px solid #000;padding:5px;">${row.observacao}</td>
    </tr>`;
  });

  return `<table style="width:100%;text-align:center;border:1px solid #000;border-collapse:collapse;table-layout:auto;">
  <tr><th colspan="7" style="text-align:center;font-size:14px;font-weight:bold;">DADOS PARA LANÇAMENTO</th></tr>
  <tr><td colspan="7" style="text-align:center;font-size:14px;font-weight:bold;">Precatório: ${dados.numero} / ${dados.natureza} / ${dados.vencimento} / ${dados.devedor}</td></tr>
  <tr style="background:#f2f2f2">
    <th style="border:1px solid #000;padding:5px;">Data da Comunicação</th>
    <th style="border:1px solid #000;padding:5px;">Tipo</th>
    <th style="border:1px solid #000;padding:5px;">%</th>
    <th style="border:1px solid #000;padding:5px;">DE</th>
    <th style="border:1px solid #000;padding:5px;">PARA</th>
    <th style="border:1px solid #000;padding:5px;">Evento Eproc</th>
    <th style="border:1px solid #000;padding:5px;">Observação</th>
  </tr>
  ${linhasHTML}
</table>`.trim();
}

// ── Registro no contrato do core ──────────────────────────────────────────
window.templateRenderer_cessao_credito = {
  certidao: _certidao,
  minuta:   _minuta,
  tabela:   _tabela
};
