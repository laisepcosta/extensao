/**
 * core/pdfHandler.js
 * Responsável por extrair texto de PDFs e preparar para a IA.
 * Usa pdf.js (carregado via CDN ou bundled) para extração local.
 *
 * INTERFACE PÚBLICA:
 *   pdfHandler.extrairTexto(base64) → Promise<string>
 *   pdfHandler.prepararChunks(textos, limiteTokens) → string[]
 *   pdfHandler.extrairJSON(textoBruto) → Object
 *
 * ETAPA ATUAL (1 - Scaffolding): Estrutura com stubs.
 * A extração real com pdf.js será implementada na Etapa 5.
 */

const pdfHandler = (() => {

  // Limite conservador do Gemini Nano (~3500 tokens para deixar margem ao prompt)
  const LIMITE_TOKENS_PADRAO = 3500;

  /**
   * Extrai o texto completo de um PDF em base64.
   * STUB: retorna string vazia até Etapa 5.
   *
   * @param {string} base64 - PDF em base64
   * @returns {Promise<string>}
   */
  async function extrairTexto(base64) {
    // TODO (Etapa 5): Implementar com pdf.js
    // const pdfData = atob(base64);
    // const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    // ...
    console.warn("[pdfHandler] extrairTexto: stub — Etapa 5 implementará pdf.js");
    return "";
  }

  /**
   * Divide textos longos em chunks que cabem na janela de contexto da IA.
   *
   * @param {string[]} textos - Array de textos extraídos de cada PDF
   * @param {number} limiteTokens
   * @returns {string[]} - Array de chunks prontos para enviar à IA
   */
  function prepararChunks(textos, limiteTokens = LIMITE_TOKENS_PADRAO) {
    const textoCompleto = textos.join("\n\n--- PRÓXIMO DOCUMENTO ---\n\n");
    // Heurística: ~4 caracteres por token
    const limiteCars = limiteTokens * 4;

    if (textoCompleto.length <= limiteCars) {
      return [textoCompleto];
    }

    // Divide em chunks com overlap para não perder contexto nas bordas
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

  /**
   * Limpa e extrai o JSON válido de uma resposta bruta da IA.
   * Reutiliza a lógica atual de extrairELimparJSON do popup.js.
   *
   * @param {string} textoBruto
   * @returns {Object}
   */
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
