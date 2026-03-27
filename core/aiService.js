/**
 * core/aiService.js v6.0
 * Backend de IA via Gemini Pro (automação de aba do browser).
 *
 * ARQUITETURA:
 *   1. Recebe os textos extraídos dos PDFs pelo pdfHandler
 *   2. Monta o payload completo (prompt originário + dados SGP + texto dos docs)
 *   3. Envia para o background.js via chrome.runtime.sendMessage('ANALISAR_VIA_GEMINI')
 *   4. background.js orquestra a aba do Gemini via gemini.js
 *   5. Recebe o JSON de volta e retorna ao popup
 *
 * O QUE FOI REMOVIDO vs v5:
 *   ✗ SUB_TAREFAS — uma única chamada substitui as 4 sequenciais
 *   ✗ Gemini Nano (_obterSessao, sessionCache, promptStreaming)
 *   ✗ Retry com backoff (o Gemini Pro não precisa)
 *   ✗ Chunking limitado por janela de 4K tokens
 *   ✗ _montarJSONFinal (schema montado pelo Gemini diretamente)
 *
 * CHUNK_SIZE:
 *   Gemini 1.5 Pro suporta 1M tokens (~4M chars). O limite prático aqui
 *   é legibilidade e custo de tempo — definimos 80K chars como máximo
 *   por documento individual, valor bem acima do caso real de 30 páginas
 *   (~40K chars após limpeza).
 */

const aiService = (() => {

  const CONFIG = {
    // Limite por documento individual antes de truncar
    // 80K chars ≈ 20K tokens — confortável para o Gemini 1.5 Pro
    MAX_CHARS_POR_TEXTO: 80000,

    // Tamanho total máximo do payload (prompt + docs + dados SGP)
    // Gemini Pro aceita bem até 500K chars na interface web
    MAX_CHARS_TOTAL: 400000,
  };

  // ================================================================
  // MONTAGEM DO PAYLOAD
  // ================================================================

  /**
   * Monta o payload completo para envio ao Gemini Pro.
   * Combina o prompt originário do template com os textos dos PDFs
   * e os dados do precatório (SGP) fornecidos pelo usuário.
   *
   * @param {string[]} textos       - Textos extraídos dos PDFs pelo pdfHandler
   * @param {string}   promptTemplate - Prompt originário do template (template.prompt)
   * @param {string}   dadosPrecatorio - Dados do SGP em texto livre (pode ser vazio)
   * @returns {string} Payload completo pronto para envio ao Gemini
   */
  function montarPayload(textos, promptTemplate, dadosPrecatorio = '') {
    // Limita cada documento individualmente
    const textosLimitados = textos.map((t, i) => {
      if (t.length > CONFIG.MAX_CHARS_POR_TEXTO) {
        console.warn(`[aiService] Documento ${i + 1} truncado: ${t.length} → ${CONFIG.MAX_CHARS_POR_TEXTO} chars`);
        return t.slice(0, CONFIG.MAX_CHARS_POR_TEXTO);
      }
      return t;
    });

    // Junta todos os documentos com separador claro
    const textoDocumentos = textosLimitados.join('\n\n------- PRÓXIMO DOCUMENTO -------\n\n');

    // Monta a seção de dados do SGP
    const secaoSGP = dadosPrecatorio.trim()
      ? `DADOS DO PRECATÓRIO (SGP):\n\n${dadosPrecatorio.trim()}`
      : `DADOS DO PRECATÓRIO (SGP):\n\n[Dados do SGP não informados — basear-se apenas nos documentos.]`;

    // Payload final: prompt + SGP + documentos
    // Mantém exatamente a estrutura que o prompt originário espera
    const payload = promptTemplate
      + '\n\n'
      + secaoSGP
      + '\n\n'
      + '------- DOCUMENTOS PARA ANÁLISE -------\n\n'
      + textoDocumentos;

    const totalChars = payload.length;
    console.log(`[aiService] Payload montado: ${totalChars.toLocaleString()} chars (~${Math.ceil(totalChars / 4).toLocaleString()} tokens)`);

    if (totalChars > CONFIG.MAX_CHARS_TOTAL) {
      console.warn(`[aiService] ⚠️ Payload muito grande (${totalChars} chars). Considere selecionar menos documentos.`);
    }

    return payload;
  }

  // ================================================================
  // ENTRADA PRINCIPAL
  // ================================================================

  /**
   * Extrai dados dos documentos via Gemini Pro.
   *
   * @param {Object} params
   * @param {string[]} params.textos           - Textos dos PDFs (já extraídos pelo pdfHandler)
   * @param {string}   params.promptTemplate   - Prompt do template ativo
   * @param {string}   [params.dadosPrecatorio] - Dados do SGP (opcional)
   * @param {Function} [params.onProgresso]    - Callback de progresso (msg: string)
   * @returns {Promise<{sucesso: boolean, dados?: Object, erro?: string}>}
   */
  async function extrair({ textos, promptTemplate, dadosPrecatorio = '', onProgresso }) {
    const t0 = performance.now();

    if (typeof onProgresso === 'function') {
      onProgresso('Preparando documentos para análise...');
    }

    // 1. Monta o payload completo
    const payload = montarPayload(textos, promptTemplate, dadosPrecatorio);

    if (typeof onProgresso === 'function') {
      onProgresso('Enviando para o Gemini Pro (isso pode levar até 1 minuto)...');
    }

    // 2. Delega ao background.js, que orquestra a aba do Gemini
    let resposta;
    try {
      resposta = await chrome.runtime.sendMessage({
        tipo:    'ANALISAR_VIA_GEMINI',
        payload: payload,
      });
    } catch (err) {
      console.error('[aiService] Erro na comunicação com background:', err);
      return { sucesso: false, erro: 'Falha na comunicação com o background: ' + err.message };
    }

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    // 3. Trata a resposta
    if (!resposta?.sucesso) {
      console.error(`[aiService] ❌ Gemini falhou em ${elapsed}s:`, resposta?.erro);
      return { sucesso: false, erro: resposta?.erro || 'Resposta inválida do Gemini.' };
    }

    console.log(`[aiService] ✅ JSON recebido em ${elapsed}s`);
    return { sucesso: true, dados: resposta.json };
  }

  // ================================================================
  // COMPATIBILIDADE: verificarDisponibilidade
  // O Gemini Pro está disponível se o usuário estiver logado.
  // Não há como verificar programaticamente sem tentar abrir a aba.
  // Retornamos sempre disponível — erros de login aparecem no fluxo de extração.
  // ================================================================

  async function verificarDisponibilidade() {
    return { disponivel: true, motivo: 'gemini-pro-web' };
  }

  // limparCache mantido por compatibilidade com código que possa chamá-lo
  function limparCache() {
    console.log('[aiService] limparCache() — sem efeito no modo Gemini Pro Web.');
  }

  // ================================================================
  // API PÚBLICA
  // ================================================================

  return {
    extrair,
    montarPayload,
    verificarDisponibilidade,
    limparCache,
    CONFIG,
  };

})();