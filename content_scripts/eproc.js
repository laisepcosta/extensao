/**
 * content_scripts/eproc.js
 * Roda dentro da aba do eProc. Responsável por:
 * 1. Detectar página de processo e ler eventos/documentos do DOM
 * 2. Enviar dados para o side panel via background.js
 * 3. Executar downloads de PDF no contexto da página (resolve auth)
 *
 * POR QUE O DOWNLOAD FICA AQUI:
 * O eProc valida hash+key vinculados à sessão PHP e verifica que a
 * requisição vem do contexto de página (cookies HttpOnly + SameSite).
 * Um fetch() do service worker é bloqueado e retorna HTML de erro.
 * O content_script roda dentro da aba autenticada, então fetch() aqui
 * funciona normalmente com as mesmas credenciais do usuário logado.
 *
 * ESTRUTURA DO DOM (eProc TJMG 9.18.x):
 *   <input name="num_processo" value="27973500220258130000">
 *   <title>2797350-02.2025.8.13.0000 :: eproc ...</title>
 *   <table id="tblEventos">
 *     <tr id="trEvento112" data-parte="TERCEIRO INTERESSADO">
 *       <td>★</td>
 *       <td><span>112</span></td>         ← número
 *       <td>17/03/2026 16:36:52</td>      ← data
 *       <td class="infraEventoDescricao">
 *         <label class="infraEventoDescricao">PETIÇÃO</label>
 *       </td>
 *       <td>usuário</td>
 *       <td>                              ← documentos
 *         <a class="infraLinkDocumento"
 *            href="controlador.php?acao=acessar_documento&doc=ID&key=KEY&hash=HASH"
 *            data-nome="PET_HABILITACAO"
 *            data-mimetype="pdf"
 *            data-doc="11773...">PET_HABILITACAO1</a>
 *       </td>
 *     </tr>
 *   </table>
 */

(function () {
  'use strict';

  if (window.__eprocAssistenteCarregado) return;
  window.__eprocAssistenteCarregado = true;

  // ================================================================
  // 1. DETECÇÃO DE PÁGINA
  // ================================================================

  function ehPaginaDeProcesso() {
    return !!(
      document.getElementById('tblEventos') &&
      document.querySelector('input[name="num_processo"]')
    );
  }

  // ================================================================
  // 2. EXTRAÇÃO DE DADOS DO DOM
  // ================================================================

  function extrairNumeroProcesso() {
    const bruto = document.querySelector('input[name="num_processo"]')?.value || '';
    const titulo = document.title || '';
    const matchTitulo = titulo.match(/^([\d\-\.]+)/);
    const formatado = matchTitulo ? matchTitulo[1].trim() : bruto;
    return { bruto, formatado };
  }

  function extrairEventos() {
    const linhas = document.querySelectorAll('#tblEventos tr[id^="trEvento"]');
    // URL base da página atual (ex: "https://eproc2g.tjmg.jus.br/eproc/")
    const baseUrl = window.location.href.replace(/[^/]*(\?.*)?$/, '');

    const eventos = [];

    linhas.forEach(tr => {
      const numero = tr.id.replace('trEvento', '');
      const colunas = tr.querySelectorAll(':scope > td');
      const dataTexto = colunas[2]?.textContent?.trim() || '';
      const data = dataTexto.split(' ')[0];
      const labelDescricao = tr.querySelector('.infraEventoDescricao');
      const tipo = labelDescricao?.textContent?.trim() || '';
      const parte = tr.dataset.parte || '';

      const linksDoc = tr.querySelectorAll('a.infraLinkDocumento');
      const documentos = Array.from(linksDoc)
        .filter(a => a.dataset.mimetype === 'pdf')
        .map(a => {
          const hrefRelativo = a.getAttribute('href') || '';
          // Mantém a URL original (acessar_documento com hash válido).
          // O chrome.downloads.download() no background navega todos os
          // redirects autenticados do eProc automaticamente.
          const urlAbsoluta = hrefRelativo.startsWith('http')
            ? hrefRelativo
            : baseUrl + hrefRelativo;

          return {
            nome:  a.dataset.nome  || a.textContent.trim(),
            label: a.textContent.trim(),
            docId: a.dataset.doc   || '',
            url:   urlAbsoluta
          };
        });

      eventos.push({ numero, data, tipo, parte, documentos });
    });

    return eventos;
  }


  // ================================================================
  // 3. FETCH DIRETO DE PDF (chamado pelo background após resolver URL)
  // ================================================================

  /**
   * PROCESSO DE DOWNLOAD DO EPROC (3 camadas):
   *
   * Camada 1: href do link  → acessar_documento          → retorna HTML com <iframe>
   * Camada 2: src do iframe → acessar_documento_implementacao → retorna HTML com <iframe>
   * Camada 3: src do iframe → URL real do PDF            → retorna o PDF
   *
   * Esta função navega as camadas via fetch() (funciona pois estamos
   * no content_script, dentro da aba autenticada do eProc).
   *
   * Baseado na técnica da extensão de raspagem do eProc que funciona
   * em produção: fetch HTML → parsear iframe → fetch PDF.
   */
  async function fetchPDFDireto(urlInicial, nome) {
    // ── Camada 1: busca o HTML wrapper e extrai o src do iframe ──────
    const res1   = await fetch(urlInicial, { credentials: 'include' });
    const html1  = await res1.text();
    const doc1   = new DOMParser().parseFromString(html1, 'text/html');
    const iframe1 = doc1.querySelector('iframe#conteudoIframe');

    if (!iframe1?.getAttribute('src')) {
      throw new Error(`"${nome}": não encontrou iframe na camada 1.`);
    }

    // Resolve URL relativa do src em relação à URL da camada 1
    const urlCamada2 = new URL(iframe1.getAttribute('src'), urlInicial).href;

    // ── Camada 2: busca o HTML da implementacao e extrai o iframe do PDF ──
    const res2  = await fetch(urlCamada2, { credentials: 'include' });
    const ct2   = res2.headers.get('content-type') || '';

    // Verifica se a camada 2 já é o PDF direto (sem mais wrappers)
    if (ct2.includes('pdf') || ct2.includes('octet')) {
      const blob2  = await res2.blob();
      const reader = new FileReader();
      return await new Promise((res, rej) => {
        reader.onload  = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(blob2);
      });
    }

    // É HTML — lê uma única vez e trabalha com o texto
    const html2   = await res2.text();
    const doc2    = new DOMParser().parseFromString(html2, 'text/html');
    const iframe2 = doc2.querySelector('iframe#conteudoIframe');

    let urlPDF;

    if (iframe2?.getAttribute('src')) {
      urlPDF = new URL(iframe2.getAttribute('src'), urlCamada2).href;
    } else {
      // Fallback: regex (mesma técnica da outra extensão)
      const match = html2.match(/url:\s*"(controlador\.php\?acao=acessar_documento_implementacao[^"]+)"/);
      if (match) {
        urlPDF = new URL(match[1].replace(/&amp;/g, '&'), urlCamada2).href;
      } else {
        throw new Error(`"${nome}": não encontrou URL do PDF na camada 2.`);
      }
    }

    // ── Camada 3: busca o PDF real ─────────────────────────────────
    const res3 = await fetch(urlPDF, { credentials: 'include' });
    const ct3  = res3.headers.get('content-type') || '';

    if (!ct3.includes('pdf') && !ct3.includes('octet')) {
      const blob3 = await res3.blob();
      throw new Error(`"${nome}": camada 3 retornou ${ct3} (${blob3.size} bytes) em vez de PDF.`);
    }

    const blob3  = await res3.blob();
    const reader = new FileReader();
    return await new Promise((resolve, reject) => {
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error(`Erro ao converter "${nome}" para base64.`));
      reader.readAsDataURL(blob3);
    });
  }

  // ================================================================
  // 3. HUB DE MENSAGENS (recebe comandos do side panel via background)
  // ================================================================

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {

    // Side panel pedindo dados do processo
    if (msg.tipo === 'SOLICITAR_DADOS_PROCESSO') {
      if (!ehPaginaDeProcesso()) {
        responder({ encontrado: false });
        return;
      }
      const { bruto, formatado } = extrairNumeroProcesso();
      responder({
        encontrado: true,
        payload: {
          numeroProcessoBruto:     bruto,
          numeroProcessoFormatado: formatado,
          baseUrl: window.location.href.replace(/[^/]*(\?.*)?$/, ''),
          eventos: extrairEventos()
        }
      });
      return; // Resposta síncrona
    }

    // Background pede para buscar PDF de uma URL já resolvida
    if (msg.tipo === 'FETCH_PDF_URL') {
      fetchPDFDireto(msg.url, msg.nome)
        .then(base64 => responder({ sucesso: true, base64 }))
        .catch(erro  => responder({ sucesso: false, erro: erro.message }));
      return true; // canal assíncrono
    }
  });

  // ================================================================
  // 5. INICIALIZAÇÃO — notifica o side panel ao carregar a página
  // ================================================================

  function inicializar() {
    if (!ehPaginaDeProcesso()) {
      console.debug('[Assistente eProc] Página não é de processo.');
      return;
    }

    const { bruto, formatado } = extrairNumeroProcesso();
    const eventos = extrairEventos();
    const totalDocs = eventos.reduce((acc, ev) => acc + ev.documentos.length, 0);

    console.log(
      `[Assistente eProc] Processo ${formatado} | ` +
      `${eventos.length} eventos | ${totalDocs} docs PDF`
    );

    chrome.runtime.sendMessage({
      tipo: 'PROCESSO_DETECTADO',
      payload: {
        numeroProcessoBruto:     bruto,
        numeroProcessoFormatado: formatado,
        baseUrl: window.location.href.replace(/[^/]*(\?.*)?$/, ''),
        eventos
      }
    }).catch(() => {
      console.debug('[Assistente eProc] Side panel não estava aberto.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    inicializar();
  }

})();
