/**
 * core/pdfHandler.js
 * Responsável por extrair texto de PDFs e preparar para a IA.
 *
 * v4.0 - CORREÇÕES:
 *  ✅ REMOVIDA reordenação de parágrafos (_priorizarConteudo) — preserva sequência do documento
 *  ✅ Limpeza de texto preserva termos jurídicos curtos (OAB, CPF, §, Art.)
 *  ✅ extrairJSON com mensagens de erro mais detalhadas
 *  ✅ Chunk size reduzido para caber no Gemini Nano
 *  ✅ Extração paralela de páginas PDF mantida
 */

const pdfHandler = (() => {

  // ================================================================
  // CONFIGURAÇÕES
  // ================================================================

  const CONFIG = {
    CHUNK_SIZE_PADRAO: 6000,       // 6K chars por chunk (cabe no Gemini Nano)
    MAX_CHARS_POR_TEXTO: 10000,    // 10K por PDF individual (escrituras longas)
    OVERLAP: 200,                   // Overlap entre chunks
    MAX_CHUNKS: 3,                  // Máximo de chunks
    REMOVER_DUPLICATAS: true        // Remove parágrafos duplicados
  };

  // ================================================================
  // LIMPEZA DE TEXTO (PRESERVA TERMOS JURÍDICOS)
  // ================================================================

  /**
   * Remove ruído típico de PDFs extraídos.
   * FIX: Não remove mais linhas curtas que contenham termos legais.
   */
  function _limparTexto(texto) {
    let limpo = texto
      // Remove URLs completas
      .replace(/https?:\/\/[^\s]+/gi, '')
      // Remove e-mails
      .replace(/[\w.-]+@[\w.-]+\.\w+/gi, '')
      
      // Remove cabeçalhos/rodapés comuns do TJMG/eProc
      .replace(/Poder Judiciário.*?Tribunal de Justiça.*?\n/gi, '')
      .replace(/Tribunal de Justiça.*?Minas Gerais.*?\n/gi, '')
      .replace(/Documento assinado digital.*?\n/gi, '')
      .replace(/Protocolo:?\s*\d+.*?\n/gi, '')
      .replace(/Validação:?\s*[A-Z0-9]+.*?\n/gi, '')
      .replace(/Página \d+ de \d+/gi, '')
      .replace(/Fl\.\s*\d+/gi, '')
      .replace(/Rubrica:.*?\n/gi, '')
      
      // Remove números de processo repetidos (mantém só primeira ocorrência)
      .replace(/(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\s+\1+/g, '$1')
      
      // Colapsa múltiplos espaços
      .replace(/[ \t]+/g, ' ')
      // Colapsa múltiplas quebras de linha (3+ vira 2)
      .replace(/\n{3,}/g, '\n\n')
      // Remove linhas que são só espaços ou pontuação
      .replace(/^[\s\-_.]+$/gm, '')
      
      // FIX: Remoção seletiva de linhas curtas
      // NÃO remove linhas que contenham: dígitos, §, Art., OAB, CPF, CNPJ, R$
      .replace(/^(?!.*[\d§])(?!.*\b(Art|OAB|CPF|CNPJ|R\$)\b).{1,3}$/gm, '')
      
      .trim();

    // Remove parágrafos duplicados se habilitado
    if (CONFIG.REMOVER_DUPLICATAS) {
      limpo = _removerDuplicatas(limpo);
    }

    return limpo;
  }

  /**
   * Remove parágrafos duplicados mantendo primeira ocorrência.
   */
  function _removerDuplicatas(texto) {
    const paragrafos = texto.split('\n\n');
    const vistos = new Set();
    const unicos = [];

    for (const p of paragrafos) {
      const chave = p.toLowerCase().trim();
      if (chave.length > 20 && !vistos.has(chave)) {
        vistos.add(chave);
        unicos.push(p);
      } else if (chave.length <= 20) {
        // Mantém parágrafos curtos (podem ser títulos importantes)
        unicos.push(p);
      }
    }

    return unicos.join('\n\n');
  }

  // ================================================================
  // EXTRAÇÃO DE TEXTO DO PDF (COM PARALELIZAÇÃO)
  // ================================================================

  async function extrairTexto(base64) {
    try {
      // Configura worker uma única vez (idempotente)
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';
      }

      const pdfData = atob(base64);
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;

      const numPaginas = pdf.numPages;
      console.log(`[pdfHandler] 📄 Extraindo ${numPaginas} páginas...`);

      // Extrai páginas em paralelo (até 4 por vez)
      const MAX_PAGINAS_PARALELAS = 4;
      const textosPaginas = [];

      for (let i = 1; i <= numPaginas; i += MAX_PAGINAS_PARALELAS) {
        const lote = [];
        for (let j = i; j < Math.min(i + MAX_PAGINAS_PARALELAS, numPaginas + 1); j++) {
          lote.push(
            pdf.getPage(j)
              .then(pagina => pagina.getTextContent())
              .then(conteudo => conteudo.items.map(item => item.str).join(' '))
              .catch(err => {
                console.warn(`[pdfHandler] ⚠️ Erro na página ${j}:`, err.message);
                return '';
              })
          );
        }
        const resultados = await Promise.all(lote);
        textosPaginas.push(...resultados);
      }

      const textoCompleto = textosPaginas.join('\n\n');
      console.log(`[pdfHandler] ✅ ${numPaginas} páginas extraídas (${textoCompleto.length} chars)`);

      // Limpa o texto antes de retornar
      const textoLimpo = _limparTexto(textoCompleto);
      console.log(`[pdfHandler] 🧹 Texto limpo: ${textoLimpo.length} chars (economia de ${((1 - textoLimpo.length / textoCompleto.length) * 100).toFixed(1)}%)`);

      return textoLimpo;

    } catch (erro) {
      console.error('[pdfHandler] ❌ Erro ao extrair texto do PDF:', erro);
      throw new Error('Falha ao processar o PDF localmente.');
    }
  }

  // ================================================================
  // PREPARAR CHUNKS (SEM REORDENAÇÃO)
  // ================================================================

  function prepararChunks(textos, chunkSize = CONFIG.CHUNK_SIZE_PADRAO) {
    console.log(`[pdfHandler] 📦 Preparando chunks (${chunkSize} chars cada)`);

    // Limita tamanho individual de cada documento
    const textosLimitados = textos.map((t, idx) => {
      if (t.length > CONFIG.MAX_CHARS_POR_TEXTO) {
        console.log(`[pdfHandler] ⚠️ Documento ${idx + 1} truncado: ${t.length} → ${CONFIG.MAX_CHARS_POR_TEXTO} chars`);
        return t.slice(0, CONFIG.MAX_CHARS_POR_TEXTO);
      }
      return t;
    });

    // Junta todos os documentos
    const textoCompleto = textosLimitados.join('\n\n--- PRÓXIMO DOCUMENTO ---\n\n');
    
    console.log(`[pdfHandler] 📊 Texto total: ${textoCompleto.length} chars`);

    // Se couber em 1 chunk, retorna direto
    if (textoCompleto.length <= chunkSize) {
      console.log(`[pdfHandler] ✅ 1 chunk suficiente`);
      return [textoCompleto];
    }

    // FIX: Divide em chunks SEM reordenar parágrafos (preserva sequência)
    const chunks = [];
    let inicio = 0;

    while (inicio < textoCompleto.length && chunks.length < CONFIG.MAX_CHUNKS) {
      const fim = Math.min(inicio + chunkSize, textoCompleto.length);
      const chunk = textoCompleto.slice(inicio, fim);
      chunks.push(chunk);
      
      // Move para próximo chunk com overlap
      inicio = fim - CONFIG.OVERLAP;
      if (inicio >= fim) break;
    }

    console.log(`[pdfHandler] ✂️ Dividido em ${chunks.length} chunks`);
    chunks.forEach((c, i) => {
      console.log(`[pdfHandler]   Chunk ${i + 1}: ${c.length} chars`);
    });

    return chunks;
  }

  // ================================================================
  // EXTRAIR JSON DA RESPOSTA DA IA (COM MELHOR DIAGNÓSTICO)
  // ================================================================

  function extrairJSON(textoBruto) {
    if (!textoBruto || textoBruto.trim().length === 0) {
      throw new Error('Resposta da IA está vazia.');
    }

    // Remove todos os tipos de "noise" que o modelo pode adicionar
    let textoLimpo = textoBruto
      // Remove citações [cite:...], 【...】, [1], [2,3]
      .replace(/\[cite[^\]]*\]/gi, '')
      .replace(/【[^】]*】/g, '')
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '')
      
      // Remove blocos de markdown
      .replace(/```json\s*/gi, '')
      .replace(/```javascript\s*/gi, '')
      .replace(/```\s*/gi, '')
      
      // Remove possíveis prefixos comuns
      .replace(/^(Aqui está|Resultado|Resposta|JSON):\s*/gi, '')
      .replace(/^(Here is|Result|Response):\s*/gi, '')
      
      .trim();

    // Tenta encontrar JSON válido
    const match = textoLimpo.match(/\{[\s\S]*\}/);
    if (!match) {
      const preview = textoBruto.slice(0, 200);
      console.error(`[pdfHandler] ❌ Resposta não contém JSON (${textoBruto.length} chars): "${preview}"`);
      throw new Error(
        `Resposta da IA não contém JSON válido (${textoBruto.length} chars). ` +
        `Início: "${preview.slice(0, 50)}..."`
      );
    }

    try {
      const parsed = JSON.parse(match[0]);
      console.log('[pdfHandler] ✅ JSON parseado com sucesso');
      return parsed;
    } catch (erro) {
      // Tenta consertar JSON truncado (comum com timeout)
      const tentativaFixo = _tentarConsertarJSON(match[0]);
      if (tentativaFixo) {
        console.log('[pdfHandler] 🔧 JSON consertado após truncamento');
        return tentativaFixo;
      }
      
      console.error('[pdfHandler] ❌ Falha ao parsear JSON:', match[0].slice(0, 300));
      throw new Error(`JSON inválido na resposta (${match[0].length} chars). Erro: ${erro.message}`);
    }
  }

  /**
   * Tenta consertar JSON truncado por timeout.
   * Fecha chaves/colchetes abertos e tenta parsear.
   */
  function _tentarConsertarJSON(jsonBruto) {
    try {
      let texto = jsonBruto;
      
      // Conta chaves/colchetes abertos
      let chaves = 0, colchetes = 0;
      let dentroString = false;
      let escape = false;
      
      for (const c of texto) {
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { dentroString = !dentroString; continue; }
        if (dentroString) continue;
        if (c === '{') chaves++;
        if (c === '}') chaves--;
        if (c === '[') colchetes++;
        if (c === ']') colchetes--;
      }

      // Remove trailing comma ou texto incompleto
      texto = texto.replace(/,\s*$/, '');
      texto = texto.replace(/:\s*$/, ': null');
      texto = texto.replace(/:\s*"[^"]*$/, ': ""');
      
      // Fecha colchetes e chaves faltantes
      while (colchetes > 0) { texto += ']'; colchetes--; }
      while (chaves > 0) { texto += '}'; chaves--; }

      return JSON.parse(texto);
    } catch (_) {
      return null;
    }
  }

  // ================================================================
  // ESTATÍSTICAS DE TEXTO (HELPER)
  // ================================================================

  function analisarTexto(texto) {
    return {
      chars: texto.length,
      palavras: texto.split(/\s+/).length,
      linhas: texto.split('\n').length,
      paragrafos: texto.split('\n\n').length,
      estimativaTokens: Math.ceil(texto.length / 4)
    };
  }

  // ================================================================
  // API PÚBLICA
  // ================================================================

  return { 
    extrairTexto, 
    prepararChunks, 
    extrairJSON,
    analisarTexto,
    CONFIG
  };

})();