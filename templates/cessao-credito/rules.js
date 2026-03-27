/**
 * templates/cessao-credito/rules.js
 * Motor de regras específico para cessão de crédito.
 * Migrado de motorDeRegras.js + dicionarioFrases.js.
 *
 * CONTRATO: Registra window.templateRules_cessao_credito
 * com o método processar(dadosIA, inputs) → { textos, tabela }
 */

// ── Dicionário de Frases (migrado de dicionarioFrases.js) ──────────────────
const _frases = {
  REL_BASE_PERC_INSTRUMENTO: {
    base_total_precatorio: "O instrumento acostado dispõe que a cessão abrange <strong>{{PERC_INSTRUMENTO}}% do valor do precatório</strong>.",
    base_cota_cedente: "O instrumento acostado dispõe que a cessão abrange <strong>{{PERC_INSTRUMENTO}}% do crédito titularizado pelo(s) cedente(s)</strong> no precatório.",
    base_totalidade_cedente_confirmada: "O instrumento acostado dispõe que a cessão abrange <strong>{{PERC_INSTRUMENTO}}% do valor do precatório</strong>, percentual que corresponde a <strong>100% do crédito de titularidade do(a) cedente</strong>.",
    base_conjunta_principal_honorarios: "O instrumento acostado dispõe que a cessão abrange <strong>100% do valor do precatório</strong>, contemplando o crédito principal e os honorários contratuais."
  },
  REL_TIPO_RESSALVA: {
    sem_previsao: "Não existe ressalva quanto à existência de honorários advocatícios contratuais.",
    ressalva_sem_percentual: "Existe ressalva quanto à existência de eventuais honorários advocatícios contratuais, sem indicação expressa do respectivo percentual.",
    ressalva_inclui_periciais_com_percentual_nao_cedidos: "Existe ressalva quanto à existência de honorários advocatícios contratuais, no percentual de <strong>{{PERC_RESSALVA_CONTRATUAIS}}%</strong>, e de honorários periciais, no percentual de <strong>{{PERC_RESSALVA_PERICIAIS}}%</strong>, ambos não integrantes da cessão.",
    ressalva_com_percentual_nao_cedidos: "Existe ressalva quanto à existência de honorários advocatícios contratuais no percentual de <strong>{{PERC_RESSALVA_CONTRATUAIS}}%</strong>, os quais não integram a cessão.",
    ressalva_com_percentual_cedidos: "Existe ressalva quanto à existência de honorários advocatícios contratuais no percentual de <strong>{{PERC_RESSALVA_CONTRATUAIS}}%</strong>, os quais integram a cessão.",
    cessao_exclusiva_contratuais: "O crédito objeto da cessão refere-se exclusivamente a honorários advocatícios contratuais.",
    cessao_exclusiva_sucumbenciais: "O crédito objeto da cessão refere-se exclusivamente a honorários advocatícios sucumbenciais.",
    cessao_exclusiva_periciais: "O crédito objeto da cessão refere-se exclusivamente a honorários periciais.",
    quitados_pelo_cessionario: "Há, ainda, menção a honorários advocatícios contratuais devidos a <strong>{{NOMES_ADVOGADOS}}</strong>, os quais foram quitados diretamente pelo(s) cessionário(s)."
  },
  REL_SUPERPREFERENCIA: {
    sem_previsao: "Não se verifica, na documentação apresentada, informação sobre eventual direito ao recebimento de parcela superpreferencial.",
    englobada_e_nao_recebida: "Nos termos pactuados, a cessão engloba eventual direito à parcela superpreferencial, declarando a parte cedente não ter recebido qualquer adiantamento a este título.",
    englobada_pela_cessao: "Nos termos pactuados, a cessão engloba eventual direito à parcela superpreferencial.",
    renunciada: "Nos termos pactuados, o(s) cedente(s) declara(m) renunciar a eventual direito ao recebimento de parcela superpreferencial.",
    mantida: "Nos termos pactuados, o(s) cedente(s) declara(m) manter eventual direito ao recebimento de parcela superpreferencial.",
    nao_recebida: "Nos termos pactuados, o(s) cedente(s) declara(m) não ter(em) recebido qualquer adiantamento relativo à parcela superpreferencial.",
    ja_recebida: "Nos termos pactuados, o(s) cedente(s) declara(m) o prévio recebimento de adiantamento relativo à parcela superpreferencial."
  },
  REL_REQUERIMENTO_DESTAQUE: {
    nao: "(omitido)",
    sim: "Ademais, {{PREFIXO_PEDIDO}} {{EVENTO_PEDIDO_DESTAQUE}}, há requerimento de destaque de honorários advocatícios contratuais, no percentual de <strong>{{PERC_DEFERIDO_AGORA}}%</strong>, em favor de <strong>{{BENEFICIARIO_PEDIDO_DESTAQUE}}</strong>."
  },
  DEC_DESTAQUE_HONORARIOS: {
    ja_destacados_sem_req: "Consta, {{PREFIXO_PREVIO}} {{EVENTO_DESTAQUE_PREVIO}}, destaque de honorários advocatícios contratuais no percentual de <strong>{{PERC_DESTAQUE_PREVIO}}%</strong>, em favor de <strong>{{BENEFICIARIO_DESTAQUE_PREVIO}}</strong>.",
    ja_destacados_com_req: "Quanto ao requerimento de destaque, consta, {{PREFIXO_PREVIO}} {{EVENTO_DESTAQUE_PREVIO}}, destaque de honorários advocatícios contratuais no percentual de <strong>{{PERC_DESTAQUE_PREVIO}}%</strong>, em favor do(s) Requerente(s). Assim, indefiro o pedido.",
    nao_destacados_com_req_com_contrato: "Quanto ao requerimento de destaque, presentes os pressupostos do art. 8º, §3º, da Resolução n.° 303/2019 do CNJ e do art. 22, §4º, da Lei n.º 8.906/94 (EOAB), <strong>REGISTRE(M)-SE {{BENEFICIARIO_PEDIDO_DESTAQUE}}</strong> como beneficiário(s) dos referidos honorários.",
    nao_destacados_com_req_sem_contrato: "Quanto ao requerimento de destaque, ausente o instrumento exigido pelo art. 8º, §3º, da Resolução n.º 303/2019 do CNJ e pelo art. 22, §4º, da Lei n.º 8.906/94 (EOAB), INDEFIRO, por ora, o pedido.",
    nao_destacados_sem_req_com_ressalva: "Não há registro de destaque de honorários advocatícios contratuais nos autos. O destaque depende de requerimento expresso, devidamente instruído com o respectivo instrumento, protocolado antes da ordem de pagamento, nos termos do art. 22, §4º, da Lei n.º 8.906/94, c/c o art. 8º, §3º, da Resolução n.° 303/2019 do CNJ.",
    nao_destacados_sem_req_sem_ressalva: "Não há registro de destaque de honorários advocatícios contratuais nos autos.",
    nao_destacados_com_req_quitados: "Quanto ao requerimento de destaque, uma vez que os honorários foram quitados diretamente pelo(s) cessionário(s), conforme pactuado, resta prejudicada a análise do pedido.",
    nao_destacados_sem_req_quitados: "Quanto à quitação dos honorários contratuais, uma vez que não houve registro de destaque prévio, nada há a prover."
  }
};

// ── Funções Auxiliares (migradas de motorDeRegras.js) ──────────────────────
function _getPrefixoEvento(eventoInput) {
  if (!eventoInput) return "";
  const texto = String(eventoInput);
  if (texto.match(/[-–,;&/]/) || texto.match(/( e | a )/)) return "aos eventos";
  return "ao evento";
}

function _formatarPerc(valor) {
  if (valor === null || valor === undefined) return "0";
  const num = parseFloat(valor);
  if (Number.isInteger(num)) return num.toString();
  return num.toFixed(2).replace(".", ",");
}

function _preencher(template, valores) {
  if (!template) return "";
  return template.replace(/{{(\w+)}}/g, (match, tag) =>
    valores[tag] !== undefined ? valores[tag] : match
  );
}

// ── Processamento Principal ────────────────────────────────────────────────
function _processar(extracaoIA, inputsUsuario) {
  // Compatibilidade: suporta tanto a estrutura nova (requerimento_cessao)
  // quanto acesso direto (instrumento_cessao) para retrocompatibilidade
  const reqCessao = extracaoIA?.requerimento_cessao || {};
  const inst = reqCessao.instrumento_cessao || extracaoIA?.instrumento_cessao || {};
  const objEcon = inst.objeto_economico || {};
  const objEfeitos = inst.ressalva_honorarios || {};

  const percInstrumento = objEcon.percentual_instrumento?.percentual_numero || 0;
  const indicadorTotalidade = objEcon.indicador_totalidade?.abrange_totalidade || false;
  const inferiorEquivaleTotalidade = inputsUsuario.inferiorEquivaleTotalidade || false;
  const tipoRessalva = objEfeitos.tipo || "sem_previsao";
  const percRessalva = objEfeitos.percentual_contratuais || 0;
  const cessaoExclusiva = inst.cessao_exclusiva_honorarios?.tipo || "NAO";

  const existeDestaquePrevio = inputsUsuario.existeDestaquePrevio || false;
  const percDestaquePrevio = parseFloat(inputsUsuario.percDestaquePrevio) || 0;
  const deferidoNestaAnalise = inputsUsuario.deferidoNestaAnalise || false;
  const percDeferidoAgora = parseFloat(inputsUsuario.percDeferidoAgora) || 0;
  const opcaoDivergencia = inputsUsuario.opcaoDivergencia || "1";
  const baseIA = objEcon.base_calculo?.classificacao || "BASE_INDEFINIDA";

  let somaDestaquesJudiciais = 0;
  if (existeDestaquePrevio) somaDestaquesJudiciais += percDestaquePrevio;
  if (deferidoNestaAnalise) somaDestaquesJudiciais += percDeferidoAgora;

  let percentualNSC = 0;
  let observacaoNSC = "";
  let indicadorTotalidadeEfetivo = indicadorTotalidade || inferiorEquivaleTotalidade;

  // Cálculo NSC
  if (["CONTRATUAIS", "SUCUMBENCIAIS", "PERICIAIS"].includes(cessaoExclusiva)) {
    percentualNSC = indicadorTotalidadeEfetivo ? 100 : percInstrumento;
    observacaoNSC = `Cessão exclusiva de honorários ${cessaoExclusiva.toLowerCase()}.`;
  } else if (indicadorTotalidadeEfetivo) {
    let deducao = 0;
    let fraseRes = "";

    if (tipoRessalva === "quitados_pelo_cessionario") {
      deducao = 0;
      fraseRes = "Honorários contratuais quitados pelo cessionário.";
    } else if (tipoRessalva === "ressalva_sem_percentual") {
      deducao = somaDestaquesJudiciais > 0 ? 0 : 20;
      fraseRes = somaDestaquesJudiciais > 0
        ? "Ressalva de honorários sem percentual expresso."
        : "Ressalva de honorários: aplicado 20% por ausência de percentual expresso.";
    } else if (["ressalva_com_percentual_nao_cedidos", "ressalva_inclui_periciais_com_percentual_nao_cedidos"].includes(tipoRessalva)) {
      if (somaDestaquesJudiciais > 0) {
        if (Math.abs(percRessalva - somaDestaquesJudiciais) <= 0.02) {
          deducao = 0;
          fraseRes = `Ressalva coincidente (${_formatarPerc(percRessalva)}%).`;
        } else {
          if (opcaoDivergencia === "1") deducao = 0;
          else if (opcaoDivergencia === "2") deducao = percRessalva;
          else deducao = (percRessalva > somaDestaquesJudiciais) ? (percRessalva - somaDestaquesJudiciais) : 0;
          fraseRes = `Ressalva de honorários contratuais (${_formatarPerc(percRessalva)}%).`;
        }
      } else {
        deducao = percRessalva;
        fraseRes = `Ressalva de honorários contratuais (${_formatarPerc(percRessalva)}%).`;
      }
    }

    percentualNSC = 100 - deducao;
    const fraseDestaque = somaDestaquesJudiciais > 0
      ? `Destaque de honorários (${_formatarPerc(somaDestaquesJudiciais)}%).`
      : "Não há destaque prévio.";
    observacaoNSC = `${fraseDestaque} ${fraseRes}`.trim();
  } else {
    percentualNSC = percInstrumento;
    observacaoNSC = `Cessão parcial expressa (${_formatarPerc(percInstrumento)}%).`;
  }

  // Tags para templates de frases
  const tags = {
    PERC_INSTRUMENTO: _formatarPerc(percInstrumento),
    PERC_RESSALVA_CONTRATUAIS: _formatarPerc(percRessalva),
    PERC_RESSALVA_PERICIAIS: _formatarPerc(objEfeitos.percentual_periciais || 0),
    PERC_DEFERIDO_AGORA: _formatarPerc(percDeferidoAgora),
    PERC_DESTAQUE_PREVIO: _formatarPerc(percDestaquePrevio),
    EVENTO_COMUNICACAO_CESSAO: inputsUsuario.eventoComunicacao,
    EVENTO_PEDIDO_DESTAQUE: inputsUsuario.eventoPedidoDestaque,
    EVENTO_DESTAQUE_PREVIO: inputsUsuario.eventoDestaquePrevio,
    PREFIXO_COMUNICACAO: _getPrefixoEvento(inputsUsuario.eventoComunicacao),
    PREFIXO_PEDIDO: _getPrefixoEvento(inputsUsuario.eventoPedidoDestaque),
    PREFIXO_PREVIO: _getPrefixoEvento(inputsUsuario.eventoDestaquePrevio),
    CEDENTE_NOME: (inputsUsuario.cedentesLegitimos || []).join(", ").replace(/, ([^,]*)$/, ' e $1'),
    CESSIONARIO_NOME: (inst.partes?.cessionarios || []).map(c => c.nome).join(", ").replace(/, ([^,]*)$/, ' e $1') || "[CESSIONÁRIO]",
    BENEFICIARIO_PEDIDO_DESTAQUE: inputsUsuario.beneficiarioDestaqueNovo,
    BENEFICIARIO_DESTAQUE_PREVIO: inputsUsuario.beneficiarioDestaquePrevio,
    NOMES_ADVOGADOS: inputsUsuario.beneficiarioDestaqueNovo
  };

  // Seleção de chaves de frases
  let chaveR14 = "base_total_precatorio";
  if (percInstrumento === 100 && tipoRessalva === "sem_previsao") chaveR14 = "base_conjunta_principal_honorarios";
  else if (percInstrumento === 100) chaveR14 = (baseIA === "BASE_COTA_CEDENTE") ? "base_cota_cedente" : "base_total_precatorio";
  else if (baseIA === "BASE_TOTAL_PRECATÓRIO" && inferiorEquivaleTotalidade) chaveR14 = "base_totalidade_cedente_confirmada";
  else if (baseIA === "BASE_COTA_CEDENTE") chaveR14 = "base_cota_cedente";

  let chaveR10 = "";
  if (!["cessao_exclusiva_contratuais", "cessao_exclusiva_sucumbenciais", "cessao_exclusiva_periciais"].includes(tipoRessalva)) {
    if (existeDestaquePrevio) {
      if (deferidoNestaAnalise) {
        chaveR10 = (percDeferidoAgora === percDestaquePrevio) ? "ja_destacados_com_req" : "nao_destacados_com_req_com_contrato";
      } else chaveR10 = "ja_destacados_sem_req";
    } else {
      if (deferidoNestaAnalise) chaveR10 = "nao_destacados_com_req_com_contrato";
      else {
        if (tipoRessalva === "quitados_pelo_cessionario") chaveR10 = "nao_destacados_sem_req_quitados";
        else if (["ressalva_com_percentual_nao_cedidos", "ressalva_inclui_periciais_com_percentual_nao_cedidos", "ressalva_sem_percentual"].includes(tipoRessalva)) chaveR10 = "nao_destacados_sem_req_com_ressalva";
        else chaveR10 = "nao_destacados_sem_req_sem_ressalva";
      }
    }
  }

  const textos = {
    basePerc:        _preencher(_frases.REL_BASE_PERC_INSTRUMENTO[chaveR14], tags),
    ressalva:        _preencher(_frases.REL_TIPO_RESSALVA[tipoRessalva], tags),
    superpreferencia:_preencher(_frases.REL_SUPERPREFERENCIA[inst.superpreferencia?.status || "sem_previsao"], tags),
    reqDestaque:     _preencher(_frases.REL_REQUERIMENTO_DESTAQUE[deferidoNestaAnalise ? "sim" : "nao"], tags),
    decisaoDestaque: chaveR10 ? _preencher(_frases.DEC_DESTAQUE_HONORARIOS[chaveR10], tags) : ""
  };

  const meta = extracaoIA?.metadados_precatorio || {};
  const tabela = {
    numero:    meta.processo_eproc || "[NÚMERO]",
    natureza:  meta.natureza || "[NATUREZA]",
    vencimento:meta.vencimento || "[ANO]",
    devedor:   meta.devedor || "[DEVEDOR]",
    linhasNSC: (inputsUsuario.cedentesLegitimos || []).map(nome => ({
      data:       inputsUsuario.dataComunicacao || "[DATA]",
      tipo:       "Cessão",
      percentual: _formatarPerc(percentualNSC),
      de:         nome,
      para:       tags.CESSIONARIO_NOME,
      evento:     inputsUsuario.eventoInstrumento || "-",
      observacao: observacaoNSC
    }))
  };

  return { textos, tabela };
}

// ── Registro no contrato do core ──────────────────────────────────────────
window.templateRules_cessao_credito = { processar: _processar };
