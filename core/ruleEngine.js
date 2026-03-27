/**
 * core/ruleEngine.js
 * Motor de regras agnóstico. Delega o processamento real
 * para o rules.js do template ativo.
 *
 * INTERFACE PÚBLICA:
 *   ruleEngine.processar(dadosIA, inputsUsuario, templateId) → ResultadoProcessado
 *
 * O core NUNCA conhece as regras de negócio específicas de cada
 * template — apenas sabe como chamar a interface padronizada.
 *
 * CONTRATO que todo rules.js de template DEVE implementar:
 *   window.templateRules_[id].processar(dadosIA, inputs) → { textos, tabela }
 */

const ruleEngine = (() => {

  /**
   * Processa os dados da IA aplicando as regras do template ativo.
   *
   * @param {Object} dadosIA - JSON extraído da IA
   * @param {Object} inputsUsuario - Dados do formulário (Passo 1)
   * @param {string} templateId - ID do template ativo
   * @returns {{ textos: Object, tabela: Object }}
   */
  function processar(dadosIA, inputsUsuario, templateId = "cessao-credito") {
    // Monta o nome da variável global que o rules.js do template registra
    const nomeRegistro = `templateRules_${templateId.replace(/-/g, "_")}`;
    const regras = window[nomeRegistro];

    if (!regras || typeof regras.processar !== "function") {
      throw new Error(
        `[ruleEngine] Rules do template "${templateId}" não encontradas. ` +
        `Certifique-se que templates/${templateId}/rules.js está carregado ` +
        `e registra window.${nomeRegistro}.`
      );
    }

    return regras.processar(dadosIA, inputsUsuario);
  }

  return { processar };
})();
