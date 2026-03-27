/**
 * background.js
 * Ponte de mensagens entre side panel e content_script.
 * O download real ocorre no content_script (eproc.js) via fetch() em 3 camadas.
 */

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });

  setTimeout(async () => {
    try {
      const resposta = await chrome.tabs.sendMessage(tab.id, {
        tipo: 'SOLICITAR_DADOS_PROCESSO'
      });
      if (resposta?.encontrado) {
        chrome.runtime.sendMessage({
          tipo: 'DADOS_PROCESSO',
          payload: resposta.payload
        }).catch(() => {
          chrome.storage.session.set({ processoDetectado: resposta.payload });
        });
      }
    } catch (err) {
      console.debug('[background] Sem content_script na aba:', err.message);
    }
  }, 600);
});

chrome.runtime.onMessage.addListener((mensagem, remetente, responder) => {
  switch (mensagem.tipo) {

    case 'PROCESSO_DETECTADO':
      chrome.runtime.sendMessage({
        tipo: 'DADOS_PROCESSO',
        payload: mensagem.payload
      }).catch(() => {
        chrome.storage.session.set({ processoDetectado: mensagem.payload });
      });
      responder({ recebido: true });
      break;

    // Side panel → content_script: baixar PDFs (navegação das 3 camadas no content_script)
    case 'BAIXAR_PDFS':
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) {
          responder({ sucesso: false, erro: 'Aba do eProc não encontrada.' });
          return;
        }
        try {
          // Delega cada download para o content_script em sequência
          const arquivos = [];
          for (let i = 0; i < mensagem.anexos.length; i++) {
            const anexo = mensagem.anexos[i];

            // Progresso
            chrome.runtime.sendMessage({
              tipo: 'PROGRESSO_DOWNLOAD',
              atual: i + 1, total: mensagem.anexos.length, nome: anexo.nome
            }).catch(() => {});

            const res = await chrome.tabs.sendMessage(tabId, {
              tipo: 'FETCH_PDF_URL',
              url:  anexo.url,
              nome: anexo.nome
            });

            if (!res?.sucesso) throw new Error(res?.erro || `Falha em "${anexo.nome}".`);
            arquivos.push({ nome: anexo.nome, docId: anexo.docId || '', base64: res.base64 });
          }
          responder({ sucesso: true, arquivos });
        } catch (err) {
          responder({ sucesso: false, erro: err.message });
        }
      });
      return true;

    default:
      break;
  }
});
