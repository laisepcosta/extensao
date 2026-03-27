/**
 * core/aiService.js
 * Camada de IA. Usa Gemini Nano (Chrome Prompt API) com fallback para modo manual.
 * Depende de: pdfHandler (para parsing do JSON da resposta)
 */

const aiService = (() => {

  async function verificarDisponibilidade() {
    if (!window.ai?.languageModel) {
      return { disponivel: false, motivo: 'api_nao_suportada' };
    }
    try {
      const cap = await window.ai.languageModel.capabilities();
      if (cap.available === 'readily')        return { disponivel: true,  motivo: 'readily' };
      if (cap.available === 'after-download') return { disponivel: false, motivo: 'after-download' };
      return { disponivel: false, motivo: 'no' };
    } catch (e) {
      console.error('[aiService] capabilities():', e);
      return { disponivel: false, motivo: 'erro_verificacao' };
    }
  }

  /**
   * Executa extração em um único chunk de texto.
   * Retorna o objeto JSON já parseado, ou lança erro.
   */
  async function _extrairChunk(session, chunk, promptTemplate, dadosPrecatorio) {
    const promptFinal = promptTemplate
      .replace(
        '[COLE AQUI OS DADOS DO PRECATÓRIO, EX: Precatório Nº: 18931...]',
        dadosPrecatorio || ''
      )
      + '\n\nDOCUMENTOS PARA ANÁLISE:\n\n'
      + chunk;

    const respostaBruta = await session.prompt(promptFinal);
    // Usa o parser consolidado do pdfHandler — única fonte da verdade
    return pdfHandler.extrairJSON(respostaBruta);
  }

  /**
   * Ponto de entrada principal.
   * @param {string[]}  textos          - Textos extraídos de cada PDF
   * @param {string}    promptTemplate  - Template do extrator-json
   * @param {string}    dadosPrecatorio - Dados colados do SGP/TJMG
   */
  async function extrair({ textos, promptTemplate, dadosPrecatorio = '' }) {
    const status = await verificarDisponibilidade();
    if (!status.disponivel) {
      console.warn('[aiService] Indisponível. Motivo:', status.motivo);
      return { sucesso: false, fallback: true, motivo: status.motivo };
    }

    try {
      // Usa prepararChunks para respeitar o limite de contexto do Nano
      const chunks = pdfHandler.prepararChunks(textos);
      console.log(`[aiService] ${chunks.length} chunk(s) para processar.`);

      const session = await window.ai.languageModel.create({
        systemPrompt:
          'Você é um assistente jurídico estrito. ' +
          'Retorne EXCLUSIVAMENTE um objeto JSON válido, sem markdown, ' +
          'sem texto fora das chaves do JSON.'
      });

      let dadosFinais;

      if (chunks.length === 1) {
        // Caminho comum: documento cabe em um único prompt
        dadosFinais = await _extrairChunk(
          session, chunks[0], promptTemplate, dadosPrecatorio
        );
      } else {
        // Documentos grandes: processa chunks e faz merge superficial
        // Estratégia: o primeiro chunk gera a estrutura base;
        // chunks seguintes apenas enriquecem campos vazios.
        console.warn(
          `[aiService] Documento grande: ${chunks.length} chunks. ` +
          'Usando estratégia de merge.'
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
            // Chunk parcial falhou — continua com o que tem
            console.warn(`[aiService] Chunk ${i + 1} falhou, ignorado:`, e.message);
          }
        }
      }

      session.destroy();
      return { sucesso: true, dados: dadosFinais, fallback: false };

    } catch (erro) {
      console.error('[aiService] Erro durante extração:', erro);
      return { sucesso: false, fallback: true, motivo: erro.message };
    }
  }

  /**
   * Merge superficial: preenche apenas campos vazios/nulos do base com valores do parcial.
   * Não sobrescreve dados já extraídos.
   */
  function _mergeRaso(base, parcial) {
    if (!parcial || typeof parcial !== 'object') return base;
    const resultado = { ...base };
    for (const chave of Object.keys(parcial)) {
      const valBase    = resultado[chave];
      const valParcial = parcial[chave];
      const baseVazio  = valBase === null || valBase === '' || valBase === 0 ||
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

  return { verificarDisponibilidade, extrair };

})();