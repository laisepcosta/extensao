/**
 * core/templateRenderer.js
 * Renderizador agnóstico de templates. Delega a geração de HTML
 * para os renderers do template ativo.
 *
 * INTERFACE PÚBLICA:
 *   templateRenderer.renderizarCertidao(dadosIA, inputs, templateId) → string (HTML)
 *   templateRenderer.renderizarMinuta(dadosIA, inputs, textos, templateId) → string (HTML)
 *   templateRenderer.renderizarTabela(tabela, templateId) → string (HTML)
 *
 * CONTRATO que todo renderer de template DEVE implementar:
 *   window.templateRenderer_[id].certidao(dadosIA, inputs) → HTML
 *   window.templateRenderer_[id].minuta(dadosIA, inputs, textos) → HTML
 *   window.templateRenderer_[id].tabela(dados) → HTML
 */

const templateRenderer = (() => {

  function _getRenderer(templateId) {
    const nome = `templateRenderer_${templateId.replace(/-/g, "_")}`;
    const renderer = window[nome];
    if (!renderer) {
      throw new Error(
        `[templateRenderer] Renderer do template "${templateId}" não encontrado. ` +
        `Verifique se os scripts do template estão carregados.`
      );
    }
    return renderer;
  }

  function renderizarCertidao(dadosIA, inputs, templateId = "cessao-credito") {
    return _getRenderer(templateId).certidao(dadosIA, inputs);
  }

  function renderizarMinuta(dadosIA, inputs, textos, templateId = "cessao-credito") {
    return _getRenderer(templateId).minuta(dadosIA, inputs, textos);
  }

  function renderizarTabela(tabela, templateId = "cessao-credito") {
    return _getRenderer(templateId).tabela(tabela);
  }

  return { renderizarCertidao, renderizarMinuta, renderizarTabela };
})();
