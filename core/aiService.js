/**
 * core/aiService.js
 * Abstração da camada de IA. Tenta a Chrome Prompt API (IA local)
 * e faz fallback para modo manual (colar JSON) se indisponível.
 *
 * INTERFACE PÚBLICA:
 *   aiService.verificarDisponibilidade() → Promise<{ disponivel, motivo }>
 *   aiService.extrair({ textos, promptTemplate, schema }) → Promise<{ sucesso, dados, fallback }>
 *
 * ETAPA ATUAL (1 - Scaffolding): Estrutura com stubs.
 * A integração real com a Prompt API será na Etapa 6.
 */

const aiService = (() => {

  /**
   * Verifica se a Chrome Prompt API está disponível.
   * STUB: sempre retorna indisponível até a Etapa 6.
   */
  async function verificarDisponibilidade() {
    // TODO (Etapa 6): Implementar verificação real
    // const suporte = await window.ai?.languageModel?.capabilities();
    // return { disponivel: suporte?.available === 'readily', motivo: suporte?.available };
    return {
      disponivel: false,
      motivo: "api_nao_implementada" // Será "readily", "after-download" ou "no"
    };
  }

  /**
   * Extrai dados estruturados dos textos dos PDFs usando IA.
   * STUB: retorna null para ativar o fallback manual.
   *
   * @param {Object} opcoes
   * @param {string[]} opcoes.textos - Textos extraídos de cada PDF
   * @param {string} opcoes.promptTemplate - Prompt do template ativo
   * @param {Object} opcoes.schema - Schema JSON esperado
   */
  async function extrair({ textos, promptTemplate, schema }) {
    const { disponivel } = await verificarDisponibilidade();

    if (!disponivel) {
      // Fallback: sinaliza para a UI mostrar o campo de cola manual
      return { sucesso: false, fallback: true, motivo: "api_indisponivel" };
    }

    // TODO (Etapa 6): Implementar extração real
    // const sessao = await window.ai.languageModel.create({ ... });
    // const resposta = await sessao.prompt(promptMontado);
    // const json = pdfHandler.extrairJSON(resposta);
    // return { sucesso: true, dados: json, fallback: false };

    return { sucesso: false, fallback: true, motivo: "nao_implementado" };
  }

  return { verificarDisponibilidade, extrair };
})();
