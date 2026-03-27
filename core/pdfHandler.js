/**
 * core/pdfHandler.js
 * Responsável por extrair texto de PDFs e preparar para a IA.
 * Usa pdf.js (carregado localmente) para extração sem depender de internet.
 */

const pdfHandler = (() => {

  const LIMITE_TOKENS_PADRAO = 2000; // era 3500, reduzir alivia a memória

  function prepararChunks(textos, limiteTokens = LIMITE_TOKENS_PADRAO) {
    // Trunca cada texto individualmente antes de concatenar
    const MAX_CHARS_POR_TEXTO = 8000;
    const textosLimitados = textos.map(t =>
      t.length > MAX_CHARS_POR_TEXTO ? t.slice(0, MAX_CHARS_POR_TEXTO) : t
    );

    const textoCompleto = textosLimitados.join("\n\n--- PRÓXIMO DOCUMENTO ---\n\n");
    const limiteCars = limiteTokens * 4;

    if (textoCompleto.length <= limiteCars) {
      return [textoCompleto];
    }

    const overlap = 200;
    const chunks = [];
    let inicio = 0;
    const MAX_CHUNKS = 10; // segurança contra loop infinito

    while (inicio < textoCompleto.length && chunks.length < MAX_CHUNKS) {
      const fim = Math.min(inicio + limiteCars, textoCompleto.length);
      chunks.push(textoCompleto.slice(inicio, fim));
      inicio = fim - overlap;
      if (inicio >= fim) break; // evita loop infinito
    }

    return chunks;
  }

  async function extrairTexto(base64) {
    try {
      // Configurar o caminho do worker do PDF.js para o ficheiro local
      pdfjsLib.GlobalWorkerOptions.workerSrc = '../lib/pdf.worker.min.js';

      const pdfData = atob(base64);
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;

      let textoCompleto = '';

      for (let numPagina = 1; numPagina <= pdf.numPages; numPagina++) {
        const pagina = await pdf.getPage(numPagina);
        const conteudo = await pagina.getTextContent();
        const textoPagina = conteudo.items.map(item => item.str).join(' ');
        textoCompleto += textoPagina + '\n\n';
      }

      console.log(`[pdfHandler] Extraídas ${pdf.numPages} páginas com sucesso.`);
      return textoCompleto.trim();

    } catch (erro) {
      console.error('[pdfHandler] Erro ao extrair texto do PDF:', erro);
      throw new Error('Falha ao processar o PDF localmente. Verifique se a biblioteca pdf.js está na pasta lib.');
    }
  }

  function prepararChunks(textos, limiteTokens = LIMITE_TOKENS_PADRAO) {
    const textoCompleto = textos.join("\n\n--- PRÓXIMO DOCUMENTO ---\n\n");
    const limiteCars = limiteTokens * 4;

    if (textoCompleto.length <= limiteCars) {
      return [textoCompleto];
    }

    const overlap = 200;
    const chunks = [];
    let inicio = 0;

    while (inicio < textoCompleto.length) {
      const fim = Math.min(inicio + limiteCars, textoCompleto.length);
      chunks.push(textoCompleto.slice(inicio, fim));
      inicio = fim - overlap;
    }

    return chunks;
  }

  function extrairJSON(textoBruto) {
    let textoLimpo = textoBruto
      .replace(/\[cite[^\]]*\]/gi, "")
      .replace(/【[^】]*】/g, "")
      .replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, "");

    const match = textoLimpo.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Resposta da IA não contém JSON válido.");
    }

    try {
      return JSON.parse(match[0]);
    } catch (erro) {
      console.error("[pdfHandler] Falha ao parsear JSON:", match[0].slice(0, 200));
      throw erro;
    }
  }

  return { extrairTexto, prepararChunks, extrairJSON };
})();