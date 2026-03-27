/**
 * core/aiService.js
 * Camada de IA — Gemini Nano via Chrome Built-in AI (Prompt API).
 *
 * ATUALIZADO para a API estável do Chrome 138+:
 *  - Usa `LanguageModel` (global direto) em vez de `window.ai.languageModel` (depreciado)
 *  - `LanguageModel.availability()` retorna: "available" | "downloadable" | "downloading" | "unavailable"
 *  - Monitora progresso de download via evento `downloadprogress`
 *  - Usa `session.tokensLeft` para checar janela de contexto antes de cada chunk
 *  - Mantém fallback para a API legada (window.ai.languageModel) para Chrome < 138
 *  - Fallback final: modo manual (retorna sucesso: false)
 *
 * Depende de: pdfHandler (para parsing do JSON da resposta)
 */

const aiService = (() => {

  // ================================================================
  // DETECÇÃO DE API — nova (LanguageModel global) ou legada (window.ai)
  // ================================================================

  /**
   * Retorna o objeto da API de linguagem disponível no Chrome, ou null.
   * Prioriza a nova API global `LanguageModel` (Chrome 138+).
   * Faz fallback para `window.ai.languageModel` (depreciado, Chrome < 138).
   */
  function _getAPI() {
    if (typeof LanguageModel !== 'undefined') return { api: LanguageModel, versao: 'nova' };
    if (window.ai?.languageModel)             return { api: window.ai.languageModel, versao: 'legada' };
    return null;
  }

  // ================================================================
  // VERIFICAR DISPONIBILIDADE
  // ================================================================

  /**
   * Verifica se o Gemini Nano está disponível para uso.
   * @returns {{ disponivel: boolean, motivo: string, baixando?: boolean }}
   */
  async function verificarDisponibilidade() {
    const apiInfo = _getAPI();

    if (!apiInfo) {
      return { disponivel: false, motivo: 'api_nao_suportada' };
    }

    const { api, versao } = apiInfo;

    try {
      // Nova API: availability() retorna string direta
      if (versao === 'nova') {
        const status = await LanguageModel.availability();
        console.log(`[aiService] LanguageModel.availability() = "${status}"`);

        if (status === 'available')     return { disponivel: true,  motivo: 'available' };
        if (status === 'downloadable')  return { disponivel: false, motivo: 'downloadable', baixando: false };
        if (status === 'downloading')   return { disponivel: false, motivo: 'downloading',  baixando: true };
        return                                 { disponivel: false, motivo: 'unavailable' };
      }

      // API legada: capabilities() retorna objeto com .available
      const cap = await api.capabilities();
      if (cap.available === 'readily')        return { disponivel: true,  motivo: 'readily' };
      if (cap.available === 'after-download') return { disponivel: false, motivo: 'after-download', baixando: false };
      return                                         { disponivel: false, motivo: 'no' };

    } catch (e) {
      console.error('[aiService] Erro ao verificar disponibilidade:', e);
      return { disponivel: false, motivo: 'erro_verificacao' };
    }
  }

  // ================================================================
  // CRIAR SESSÃO
  // ================================================================

  /**
   * Cria uma sessão do modelo com systemPrompt.
   * Monitora download se o modelo ainda não estiver disponível localmente.
   * @param {Function} [onProgresso] - Callback(percentual: number) durante download
   */
  async function _criarSessao(onProgresso) {
    const apiInfo = _getAPI();
    if (!apiInfo) throw new Error('API do Gemini Nano não encontrada.');

    const { api, versao } = apiInfo;

    const opcoes = {
      // initialPrompts substitui systemPrompt na nova API para definir o papel do modelo
      initialPrompts: [
        {
          role: 'system',
          content:
            'Você é um assistente jurídico estrito. ' +
            'Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown, ' +
            'sem comentários, sem texto fora das chaves do JSON.'
        }
      ],
      // monitor de progresso de download (só acionado se o modelo ainda não estiver local)
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round((e.loaded ?? 0) * 100);
          console.log(`[aiService] Download do modelo: ${pct}%`);
          if (typeof onProgresso === 'function') onProgresso(pct);
        });
      }
    };

    // Na API legada, o systemPrompt era uma propriedade de topo
    if (versao === 'legada') {
      delete opcoes.initialPrompts;
      opcoes.systemPrompt =
        'Você é um assistente jurídico estrito. ' +
        'Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown, ' +
        'sem texto fora das chaves do JSON.';
    }

    const session = await api.create(opcoes);
    console.log(
      `[aiService] Sessão criada. ` +
      `Tokens disponíveis: ${session.tokensLeft ?? 'N/A'} / ${session.maxTokens ?? 'N/A'}`
    );
    return session;
  }

  // ================================================================
  // EXTRAIR UM CHUNK
  // ================================================================

  /**
   * Executa extração de dados em um único chunk de texto.
   * @param {Object} session       - Sessão ativa do LanguageModel
   * @param {string} chunk         - Trecho do texto extraído dos PDFs
   * @param {string} promptTemplate - Template com placeholder do precatório
   * @param {string} dadosPrecatorio - Dados copiados do SGP/TJMG
   * @returns {Object} JSON parseado com os dados extraídos
   */
  async function _extrairChunk(session, chunk, promptTemplate, dadosPrecatorio) {
    const promptFinal = promptTemplate
      .replace(
        '[COLE AQUI OS DADOS DO PRECATÓRIO, EX: Precatório Nº: 18931...]',
        dadosPrecatorio || ''
      )
      + '\n\nDOCUMENTOS PARA ANÁLISE:\n\n'
      + chunk;

    // Verifica se o prompt cabe na janela de contexto antes de enviar
    if (session.tokensLeft !== undefined) {
      try {
        const tokensNecessarios = await session.countPromptTokens(promptFinal);
        if (tokensNecessarios > session.tokensLeft) {
          console.warn(
            `[aiService] Prompt (${tokensNecessarios} tokens) excede janela restante ` +
            `(${session.tokensLeft} tokens). O chunk pode ser truncado.`
          );
        }
      } catch (_) {
        // countPromptTokens pode não estar disponível em versões mais antigas — ignora
      }
    }

    const respostaBruta = await session.prompt(promptFinal);
    return pdfHandler.extrairJSON(respostaBruta);
  }

  // ================================================================
  // MERGE RASO
  // ================================================================

  /**
   * Merge superficial: preenche apenas campos vazios do base com valores do parcial.
   * Não sobrescreve dados já extraídos.
   */
  function _mergeRaso(base, parcial) {
    if (!parcial || typeof parcial !== 'object') return base;
    const resultado = { ...base };
    for (const chave of Object.keys(parcial)) {
      const valBase    = resultado[chave];
      const valParcial = parcial[chave];
      const baseVazio  =
        valBase === null || valBase === '' || valBase === 0 ||
        valBase === false || valBase === undefined;

      if (baseVazio && valParcial) {
        resultado[chave] = valParcial;
      } else if (
        valBase && typeof valBase === 'object' &&
        !Array.isArray(valBase) && typeof valParcial === 'object'
      ) {
        resultado[chave] = _mergeRaso(valBase, valParcial);
      }
    }
    return resultado;
  }

  // ================================================================
  // PONTO DE ENTRADA PRINCIPAL
  // ================================================================

  /**
   * Extrai dados dos textos dos PDFs usando Gemini Nano.
   *
   * @param {string[]} textos          - Textos extraídos de cada PDF
   * @param {string}   promptTemplate  - Template do extrator JSON
   * @param {string}   dadosPrecatorio - Dados colados do SGP/TJMG
   * @param {Function} [onProgresso]   - Callback(pct) p/ progresso de download do modelo
   *
   * @returns {{ sucesso: boolean, dados?: Object, fallback: boolean, motivo?: string }}
   */
  async function extrair({ textos, promptTemplate, dadosPrecatorio = '', onProgresso }) {
    const status = await verificarDisponibilidade();

    if (!status.disponivel) {
      console.warn('[aiService] Indisponível. Motivo:', status.motivo);
      return { sucesso: false, fallback: true, motivo: status.motivo };
    }

    let session = null;
    try {
      const chunks = pdfHandler.prepararChunks(textos);
      console.log(`[aiService] ${chunks.length} chunk(s) para processar.`);

      session = await _criarSessao(onProgresso);

      let dadosFinais;

      if (chunks.length === 1) {
        // Caminho comum: documento cabe em um único prompt
        dadosFinais = await _extrairChunk(
          session, chunks[0], promptTemplate, dadosPrecatorio
        );
      } else {
        // Documentos grandes: merge progressivo
        console.warn(
          `[aiService] Documento grande: ${chunks.length} chunks. Usando estratégia de merge.`
        );
        dadosFinais = await _extrairChunk(
          session, chunks[0], promptTemplate, dadosPrecatorio
        );
        for (let i = 1; i < chunks.length; i++) {
          try {
            const parcial = await _extrairChunk(
              session, chunks[i], promptTemplate, dadosPrecatorio
            );
            dadosFinais = _mergeRaso(dadosFinais, parcial);
          } catch (e) {
            console.warn(`[aiService] Chunk ${i + 1} falhou, ignorado:`, e.message);
          }
        }
      }

      return { sucesso: true, dados: dadosFinais, fallback: false };

    } catch (erro) {
      console.error('[aiService] Erro durante extração:', erro);
      return { sucesso: false, fallback: true, motivo: erro.message };
    } finally {
      // Libera GPU/RAM da sessão sempre que terminar (sucesso ou falha)
      if (session) {
        try { session.destroy(); } catch (_) {}
      }
    }
  }

  // ================================================================
  // API PÚBLICA
  // ================================================================

  return { verificarDisponibilidade, extrair };

})();