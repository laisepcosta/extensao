/**
 * core/templateLoader.js
 * Carrega e valida templates da pasta /templates/.
 * Cada template é uma pasta autossuficiente com seu próprio
 * schema, prompt, frases e regras.
 *
 * INTERFACE PÚBLICA:
 *   templateLoader.carregar(id) → Promise<Template>
 *   templateLoader.listar() → Promise<TemplateInfo[]>
 *
 * ETAPA ATUAL (1 - Scaffolding): Carrega o template de cessão
 * diretamente. A descoberta dinâmica será na Etapa 7.
 */

const templateLoader = (() => {

  // Cache para não recarregar o mesmo template várias vezes
  const _cache = {};

  /**
   * Carrega um template pelo seu ID.
   * Atualmente suporta apenas "cessao-credito".
   *
   * @param {string} id - ID do template (ex: "cessao-credito")
   * @returns {Promise<Object>} - Template completo com metadados, schema e prompt
   */
  async function carregar(id = "cessao-credito") {
    if (_cache[id]) return _cache[id];

    try {
      // Carrega o arquivo de metadados do template
      const url = chrome.runtime.getURL(`templates/${id}/template.json`);
      const resposta = await fetch(url);

      if (!resposta.ok) {
        throw new Error(`Template "${id}" não encontrado.`);
      }

      const metadados = await resposta.json();

      // Carrega o prompt de extração
      const urlPrompt = chrome.runtime.getURL(`templates/${id}/prompt.txt`);
      const respostaPrompt = await fetch(urlPrompt);
      const prompt = await respostaPrompt.text();

      const template = { ...metadados, prompt };
      _cache[id] = template;

      console.log(`[templateLoader] Template "${id}" carregado.`);
      return template;

    } catch (erro) {
      console.error(`[templateLoader] Erro ao carregar template "${id}":`, erro);
      throw erro;
    }
  }

  /**
   * Lista todos os templates disponíveis.
   * STUB: retorna lista hardcoded até Etapa 7.
   *
   * @returns {Promise<Array<{id, nome}>>}
   */
  async function listar() {
    // TODO (Etapa 7): Descobrir templates dinamicamente
    return [
      { id: "cessao-credito", nome: "Cessão de Crédito em Precatório" }
    ];
  }

  return { carregar, listar };
})();
