/**
 * templates/cessao-credito/renderer.js  v6.0
 *
 * CSP FIX: removido o bloco <script> que era injetado via innerHTML.
 * O Manifest V3 bloqueia inline scripts mesmo dentro de innerHTML.
 *
 * A lógica de revisão por seção (toggleSecaoRevisao, confirmarSecao,
 * resetarRevisaoPorSecao, _atualizar) foi movida para popup.js,
 * onde é declarada no escopo global antes de qualquer uso.
 *
 * O renderer agora apenas gera HTML puro com data-attributes e
 * IDs que o popup.js usa para controlar o estado.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function _ok(val) {
  return val ? '<span class="icon-ok">✓ Sim</span>' : '<span class="icon-err">✗ Não</span>';
}

function _badge(texto, tipo = 'blue') {
  return `<span class="badge badge-${tipo}">${texto || '—'}</span>`;
}

function _tagDiv(texto, tipo = 'ok') {
  return `<span class="tag-div tag-${tipo}">${texto}</span>`;
}

function _linha(aspecto, analise, loc = '') {
  return `
  <div class="conf-linha">
    <div class="conf-aspecto">${aspecto}</div>
    <div class="conf-analise">${analise || '—'}</div>
    <div class="conf-loc">${loc || ''}</div>
  </div>`;
}

function _limparNome(nome) {
  if (!nome) return '—';
  return nome.replace(/^[\d.\-]+[_\-]?/, '');
}

function _renderParte(p) {
  if (!p) return '—';
  const id = p.numero_documento
    ? `<span class="badge badge-blue" style="font-family:var(--font-mono);font-size:9px;">${p.tipo_documento || 'Doc'} ${p.numero_documento}</span>`
    : (p.oab || p.oab_uf ? `<span class="badge badge-gold">OAB ${p.oab || p.oab_uf}</span>` : '');
  return `<strong>${p.nome || '—'}</strong> ${id}`;
}

// ── Seção com confirmação — sem script inline ──────────────────────────────
// Os handlers onclick chamam funções globais declaradas em popup.js

function _secaoComRevisao(id, titulo, cor, conteudo) {
  return `
  <div class="conf-secao" id="secao-${id}" data-status="pendente">
    <div class="conf-secao-header ${cor}" id="header-${id}"
         onclick="toggleSecaoRevisao('${id}')">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="secao-status-icon" id="icon-${id}">▾</span>
        <span>${titulo}</span>
      </div>
      <span class="secao-confirmada-badge hidden" id="badge-${id}">✓ Confirmada</span>
    </div>
    <div class="conf-secao-body" id="body-${id}">
      <div class="conf-secao-conteudo">${conteudo}</div>
      <div class="secao-confirmar-wrap" id="confirmar-wrap-${id}">
        <div class="secao-confirmar-hint">
          Leia os dados acima e confirme esta seção para continuar
        </div>
        <button class="secao-btn-confirmar"
                onclick="confirmarSecao('${id}')">
          ✓ &nbsp;Confirmar esta seção
        </button>
      </div>
    </div>
  </div>`;
}

// ── Certidão ───────────────────────────────────────────────────────────────

function _certidao(json, inputs) {
  const meta        = json?.metadados_precatorio || {};
  const reqCessao   = json?.requerimento_cessao  || {};
  const inst        = reqCessao.instrumento_cessao || {};
  const reqDestaque = json?.requerimento_destaque || {};
  const chk         = reqCessao.checklist_documentos || {};
  const objEcon     = inst.objeto_economico || {};
  const ressalva    = inst.ressalva_honorarios || {};

  // DADOS DO PRECATÓRIO
  const cDados = `
    ${_linha('Número (GV)',
      `<strong style="font-family:var(--font-mono);font-size:14px;">${meta.numero_precatorio || '—'}</strong>`,
      'SGP/TJMG')}
    ${_linha('Natureza / Vencimento',
      `${_badge(meta.natureza || '—', 'blue')} &nbsp; ${meta.vencimento || '—'}`,
      'SGP/TJMG')}
    ${_linha('Devedor', meta.devedor || '—', 'SGP/TJMG')}
    ${_linha('Processos',
      `<div style="display:flex;flex-direction:column;gap:3px;">
        <span><strong>Originário:</strong> ${meta.processo_judicial_originario || '—'}</span>
        <span><strong>SEI:</strong> ${meta.processo_sei || '—'}</span>
        <span><strong>Eproc:</strong> ${meta.processo_eproc || '—'}</span>
      </div>`, 'SGP/TJMG')}
    ${_linha('Destaque prévio',
      inputs.existeDestaquePrevio
        ? `${_tagDiv('SIM', 'warn')} &nbsp; <strong>${inputs.percDestaquePrevio || 0}%</strong>
           — ${inputs.beneficiarioDestaquePrevio || 'N/I'}
           &nbsp; ${_badge('Ev. ' + (inputs.eventoDestaquePrevio || '—'), 'blue')}`
        : _tagDiv('Não', 'ok'), 'Input')}`;

  // DOCUMENTOS E CHECKLIST
  const docsItens = [
    ['Petição / Comunicação',     chk.peticao_comunicacao_cessao],
    ['Instrumento de Cessão',     chk.instrumento_cessao],
    ['Docs do Cessionário',       chk.documentos_cessionario],
    ['Rep. do Cessionário',       chk.documentos_representacao_cessionario],
    ['Procurações',               chk.procuracoes],
    ['Renúncia Superpreferência', chk.termo_renuncia_superpreferencia],
    ['Quitação de Honorários',    chk.declaracao_quitacao_honorarios],
  ];
  const listaCheck = docsItens.map(([label, item]) => `
    <li>
      <span>${_ok(item?.presente)}</span>
      <span class="lbl">${label}</span>
      <span style="color:var(--text-muted);font-size:11px;margin-left:4px;">
        ${_limparNome(item?.nome_arquivo || item?.nomes_arquivos)}
      </span>
    </li>`).join('');
  const intimExcl = reqCessao.peticao_anexa?.pedido_intimacao_exclusiva;
  const cDocs = `
    ${_linha('Checklist',
      `<ul class="checklist">${listaCheck}</ul>
       <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--gray-200);
         font-size:11px;color:var(--text-muted);">
         <strong>Parecer IA:</strong> ${chk.analise_geral || '—'}
       </div>`, 'Anexos')}
    ${_linha('Intimação exclusiva',
      intimExcl?.existe_pedido
        ? `${_tagDiv('Sim', 'warn')} — ${(intimExcl.advogados_indicados || [])
            .map(a => `${a.nome} (OAB ${a.oab})`).join(', ')}
           · Procuração: ${_ok(intimExcl.procuracao_valida_anexada)}`
        : _tagDiv('Não', 'ok'),
      intimExcl?.localizacao || 'Petição')}
    ${_linha('Eventos',
      `<div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${_badge('Ev. Comunicação: ' + (inputs.eventoComunicacao || '—'), 'blue')}
        ${_badge('Ev. Instrumento: ' + (inputs.eventoInstrumento || '—'), 'blue')}
        ${inputs.dataComunicacao ? _badge('Data: ' + inputs.dataComunicacao, 'gold') : ''}
      </div>`, 'Input')}`;

  // PARTES E INSTRUMENTO
  const cedentes    = inst.partes?.cedentes    || [];
  const cessionarios = inst.partes?.cessionarios || [];
  const formalidades = inst.formalidades || {};
  const cPartes = `
    ${_linha('Cedente(s)',
      cedentes.length
        ? cedentes.map(c => `
            <div style="padding:4px 0;border-bottom:1px dashed var(--gray-200);">
              ${_renderParte(c)}
              <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">
                Parte no prec.: ${_ok(c.e_parte_precatorio)}
                ${c.analise ? ` · ${c.analise}` : ''}
              </div>
            </div>`).join('')
        : '<span style="color:var(--text-muted)">Nenhum identificado</span>',
      cedentes[0]?.localizacao || '')}
    ${_linha('Cessionário(s)',
      cessionarios.length
        ? cessionarios.map(c => `
            <div style="padding:4px 0;border-bottom:1px dashed var(--gray-200);">
              ${_renderParte(c)}
              <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">${c.analise || ''}</div>
            </div>`).join('')
        : '<span style="color:var(--text-muted)">Nenhum identificado</span>',
      cessionarios[0]?.localizacao || '')}
    ${_linha('Formalidades',
      `Data: <strong>${formalidades.data_instrumento || '—'}</strong>
       &nbsp; Assin. cedente: ${_ok(formalidades.assinatura_cedente)}
       &nbsp; Assin. cessionário: ${_ok(formalidades.assinatura_cessionario)}
       <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">${formalidades.analise || ''}</div>`,
      formalidades.localizacao || '')}
    ${inst.dados_escritura_publica?.lavrado_em_cartorio
      ? _linha('Escritura Pública',
          `${inst.dados_escritura_publica.nome_cartorio || '—'}
           · Livro ${inst.dados_escritura_publica.livro || '—'}
           · Pág. ${inst.dados_escritura_publica.pagina || '—'}`, '')
      : ''}`;

  // OBJETO ECONÔMICO
  const ressalvaNum = parseFloat(ressalva.percentual_contratuais) || 0;
  const percPrevio  = parseFloat(inputs.percDestaquePrevio) || 0;
  const percNovo    = inputs.perdaObjetoCertificada ? 0 : (parseFloat(inputs.percDeferidoAgora) || 0);
  const soma        = percPrevio + percNovo;
  let coerenciaTag, coerenciaHtml;
  if (inputs.perdaObjetoCertificada) {
    coerenciaTag  = _tagDiv('Perda de objeto certificada', 'warn');
    coerenciaHtml = `Histórico (${percPrevio}%) = Ressalva (${ressalvaNum}%) — pedido novo desconsiderado.`;
  } else if (ressalvaNum === 0 || ressalvaNum === soma) {
    coerenciaTag  = _tagDiv('Coerente', 'ok');
    coerenciaHtml = `Ressalva (${ressalvaNum}%) = Soma de destaques (${soma}%)`;
  } else {
    coerenciaTag  = _tagDiv('Divergência', 'err');
    coerenciaHtml = `Ressalva: <strong>${ressalvaNum}%</strong> · Soma: <strong>${soma}%</strong>
      (Histórico ${percPrevio}% + Novo ${percNovo}%)
      · Decisão: <strong>${inputs.opcaoDivergencia || 'N/I'}</strong>`;
  }
  const cObjeto = `
    ${_linha('Percentual cedido',
      `<strong style="font-size:15px;">${objEcon.percentual_instrumento?.percentual_numero || 0}%</strong>
       <span style="color:var(--text-muted);font-size:11px;margin-left:6px;">
         ${objEcon.percentual_instrumento?.texto_literal || ''}
       </span>
       <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">
         ${objEcon.percentual_instrumento?.analise || ''}
       </div>`,
      objEcon.percentual_instrumento?.localizacao || '')}
    ${_linha('Base de cálculo',
      `${_badge(objEcon.base_calculo?.classificacao || 'BASE_INDEFINIDA', 'gold')}
       <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">
         ${objEcon.base_calculo?.analise || ''}
       </div>`,
      objEcon.base_calculo?.localizacao || '')}
    ${_linha('Superpreferência',
      `${_badge(inst.superpreferencia?.status || 'sem_previsao',
          inst.superpreferencia?.declaracao_renuncia_expressa ? 'green' : 'gold')}
       <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">
         ${inst.superpreferencia?.analise || ''}
       </div>`,
      inst.superpreferencia?.localizacao || '')}
    ${_linha('Ressalva de honorários',
      `${_badge(ressalva.tipo || 'sem_previsao', 'gold')}
       ${ressalvaNum > 0 ? `<strong style="margin-left:6px;">${ressalvaNum}%</strong>` : ''}
       <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">${ressalva.analise || ''}</div>`,
      ressalva.localizacao || '')}
    ${_linha('Coerência destaques × ressalva',
      `${coerenciaTag} <span style="margin-left:8px;font-size:11px;">${coerenciaHtml}</span>`,
      'Motor de regras')}
    ${_linha('% NSC',
      '<span style="color:var(--text-muted);font-size:12px;">Calculado no Passo 3</span>',
      'Passo 3')}`;

  // DESTAQUE (condicional)
  let secaoDestaque = '';
  const secoesIds = ['dados', 'docs', 'partes', 'objeto'];
  if (reqDestaque.ha_requerimento) {
    secoesIds.push('destaque');
    const contrato    = reqDestaque.contrato_honorarios || {};
    const assinaturas = contrato.formalidades_instrumento?.assinaturas || {};
    const estip       = contrato.objeto_e_valores?.estipulacao_honorarios || {};
    const intimDest   = reqDestaque.peticao_anexa?.pedido_intimacao_exclusiva;
    const cDestaque = `
      ${_linha('Status do pedido', _tagDiv('Requerido', 'warn'), '')}
      ${_linha('Contrato',
        `Data: <strong>${contrato.formalidades_instrumento?.data_contrato?.data_celebracao || '—'}</strong>
         &nbsp; Assin. cliente: ${_ok(assinaturas.assinatura_cliente_presente)}
         &nbsp; Assin. advogado: ${_ok(assinaturas.assinatura_advogado_presente)}
         <div style="margin-top:3px;font-size:11px;color:var(--text-muted);">
           ${assinaturas.analise_manifestacao_vontade || ''}
         </div>`,
        contrato.formalidades_instrumento?.data_contrato?.localizacao || '')}
      ${_linha('Honorários',
        estip.possui_percentual_ou_valor_expresso
          ? `<strong>${estip.percentual_numero || 0}%</strong>
             <span style="color:var(--text-muted);font-size:11px;margin-left:6px;">
               ${estip.valor_percentual_literal || ''}
             </span>`
          : _tagDiv('Sem percentual expresso', 'err'), '')}
      ${intimDest?.existe_pedido
        ? _linha('Intimação exclusiva (destaque)',
            `${_tagDiv('Sim', 'warn')} — ${(intimDest.advogados_indicados || [])
              .map(a => `${a.nome} (OAB ${a.oab})`).join(', ')}`,
            intimDest.localizacao || '')
        : ''}`;
    secaoDestaque = _secaoComRevisao('destaque', 'Destaque de Honorários', 'gold', cDestaque);
  }

  // Armazena a lista de seções em atributo data para o popup.js ler
  // SEM nenhum <script> inline
  return `
  <div style="margin-bottom:10px;font-size:11px;color:var(--text-muted);
    display:flex;align-items:center;gap:6px;">
    <span>Certidão gerada por IA</span> <span>·</span>
    <strong style="color:var(--text);">Confirme cada seção para liberar a minuta</strong>
  </div>
  <div class="conferencia-wrap" id="conferenciaWrap"
       data-secoes='${JSON.stringify(secoesIds)}'>
    ${_secaoComRevisao('dados',   'Dados do Precatório',        'navy',  cDados)}
    ${_secaoComRevisao('docs',    'Documentos e Checklist',     'blue',  cDocs)}
    ${_secaoComRevisao('partes',  'Partes e Instrumento',       'blue',  cPartes)}
    ${_secaoComRevisao('objeto',  'Objeto Econômico e Efeitos', 'green', cObjeto)}
    ${secaoDestaque}
  </div>`;
  // NOTA: não há <script> aqui.
  // As funções toggleSecaoRevisao(), confirmarSecao(), resetarRevisaoPorSecao()
  // são declaradas globalmente em popup.js e carregadas antes do renderer.
}

// ── Minuta ─────────────────────────────────────────────────────────────────

function _minuta(extracaoIA, inputsUsuario, textos) {
  const reqCessao    = extracaoIA?.requerimento_cessao || {};
  const inst         = reqCessao.instrumento_cessao || extracaoIA?.instrumento_cessao || {};
  const cessionarios = inst.partes?.cessionarios || [];
  const nomesCedentes = inputsUsuario.cedentesLegitimos || [];
  const cedente     = nomesCedentes.join(', ').replace(/, ([^,]*)$/, ' e $1') || '[CEDENTE]';
  const cessionario = cessionarios.map(c => c.nome).join(', ').replace(/, ([^,]*)$/, ' e $1') || '[CESSIONÁRIO]';
  const eventoCom   = inputsUsuario.eventoComunicacao || '[EVENTO]';
  const prefixoCom  = (eventoCom.includes(',') || eventoCom.includes(' e ') || eventoCom.includes('-'))
    ? 'aos eventos' : 'ao evento';

  const paragrafos = [
    `Trata-se, ${prefixoCom} ${eventoCom}, de comunicação de cessão dos direitos creditórios de <strong>${cedente}</strong> em favor de <strong>${cessionario}</strong>.`,
    textos.basePerc        || '',
    textos.ressalva        || '',
    textos.superpreferencia || '',
    textos.reqDestaque      || '',
    'É o relatório. Decido.',
    textos.decisaoDestaque  || '',
    `Dê-se ciência aos procuradores do(s) beneficiário(s) (originário/cedente), bem como do devedor pelo prazo de 2 (dois) dias corridos para eventuais impugnações, nos termos do art. 80, da Resolução n.° 303/2019 do CNJ.`,
    `Decorrido o prazo sem impugnação dos interessados, <strong>REGISTRE(M)-SE ${cessionario}</strong> como beneficiário(s) cessionário(s) dos direitos previstos na cessão, com o devido cadastramento de seu(s) patrono(s).`,
    `A ordem cronológica do precatório fica mantida e o(s) cessionário(s) não faz(em) jus às preferências do § 2º do art. 100 da CR, estando sujeito(s) ao disposto no § 2º do art. 42 da Resolução n.° 303/2019 do CNJ.`,
    `Esta decisão servirá como ofício para conhecimento do juízo da execução, conforme art. 45, § 1º, da referida Resolução.`,
    `Belo Horizonte, data da assinatura eletrônica.`,
  ]
  .filter(p => p && p.trim() && p.trim() !== '(omitido)')
  .map(p => `<p>${p}</p>`)
  .join('\n');

  return `<div class="minuta-wrap">${paragrafos}</div>`;
}

// ── Tabela NSC ─────────────────────────────────────────────────────────────

function _tabela(dados) {
  const linhas = (dados.linhasNSC || []).map(row => `
    <tr>
      <td>${row.data}</td>
      <td>${row.tipo}</td>
      <td><strong>${row.percentual}%</strong></td>
      <td>${row.de}</td>
      <td>${row.para}</td>
      <td style="font-family:var(--font-mono);font-size:10px;">${row.evento}</td>
      <td style="font-size:11px;color:var(--text-muted);">${row.observacao}</td>
    </tr>`).join('');

  return `
  <div class="tabela-wrap">
    <table class="tabela-nsc">
      <tr><td colspan="7" class="caption">DADOS PARA LANÇAMENTO</td></tr>
      <tr><td colspan="7" class="caption" style="font-weight:400;font-size:11px;">
        ${dados.numero} / ${dados.natureza} / ${dados.vencimento} / ${dados.devedor}
      </td></tr>
      <tr>
        <th>Data Comunicação</th><th>Tipo</th><th>%</th>
        <th>DE</th><th>PARA</th><th>Ev. Eproc</th><th>Observação</th>
      </tr>
      ${linhas}
    </table>
  </div>`;
}

// ── Registro ───────────────────────────────────────────────────────────────

window.templateRenderer_cessao_credito = {
  certidao: _certidao,
  minuta:   _minuta,
  tabela:   _tabela,
};