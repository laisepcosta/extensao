/**
 * content_scripts/eproc.js  v4.1
 *
 * CORREÇÃO v4.1 — Hub de mensagens:
 *   O listener anterior retornava `undefined` implicitamente para
 *   SOLICITAR_DADOS_PROCESSO (via `return;` sem valor), e `true` para
 *   FETCH_PDF_URL. O Chrome fecha o canal de resposta assíncrono quando
 *   o listener retorna qualquer valor falsy (undefined, false, null).
 *
 *   O efeito prático: quando o background.js chamava chrome.tabs.sendMessage
 *   com FETCH_PDF_URL, o canal já estava fechado antes do fetchPDFDireto
 *   terminar, então o `responder({ sucesso: true, base64 })` era silenciosa-
 *   mente descartado. O background recebia `undefined` como resposta e
 *   lançava "Falha ao baixar" — ou simplesmente não recebia resposta alguma.
 *
 *   FIX: listener reestruturado com retornos explícitos:
 *     - SOLICITAR_DADOS_PROCESSO → síncrono → return false
 *     - FETCH_PDF_URL            → assíncrono → return true  (mantém canal)
 *     - default                  → return false
 *
 * NOVIDADE v4: extrairDadosTela()
 *   Lê diretamente do DOM da capa do processo todos os campos disponíveis.
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
    const formatado = document.getElementById('txtNumProcesso')?.textContent?.trim()
      || (matchTitulo ? matchTitulo[1].trim() : bruto);
    return { bruto, formatado };
  }

  function extrairDadosTela() {
    const dados = {
      numeroEproc:        '',
      numeroBruto:        '',
      processoOriginario: '',
      orgaoJulgador:      '',
      colegiado:          '',
      requerentes:        [],
      requeridos:         [],
      assuntoPrincipal:   '',
      localizadores:      [],
    };

    dados.numeroBruto = document.querySelector('input[name="num_processo"]')?.value?.trim() || '';
    dados.numeroEproc = document.getElementById('txtNumProcesso')?.textContent?.trim()
      || document.title.match(/^([\d\-\.]+)/)?.[1]?.trim()
      || dados.numeroBruto;

    const linhasRelac = document.querySelectorAll('#tableRelacionado tr');
    linhasRelac.forEach(tr => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 3) {
        const num  = tds[0]?.textContent?.trim();
        const tipo = tds[2]?.textContent?.trim().toLowerCase();
        if (tipo === 'originário' || tipo === 'originario') {
          dados.processoOriginario = num;
        } else if (!dados.processoOriginario && num) {
          dados.processoOriginario = num;
        }
      }
    });

    dados.orgaoJulgador = document.getElementById('txtOrgaoJulgador')?.textContent?.trim() || '';
    dados.colegiado     = document.getElementById('txtOrgaoColegiado')?.textContent?.trim() || '';

    const tblPartes = document.getElementById('tblPartesERepresentantes');
    if (tblPartes) {
      const celulas = tblPartes.querySelectorAll('tbody tr:first-child td');

      const extrairPartesColuna = (td) => {
        if (!td) return [];
        const partes = [];
        const nomesEls = td.querySelectorAll('label.lblParte, a.infraNomeParte, span.infraNomeParte');

        nomesEls.forEach(el => {
          const nome = el.textContent?.trim();
          if (!nome) return;
          const representantes = [];
          let next = el.parentElement?.nextElementSibling;
          while (next) {
            const adv = next.querySelector?.('.lblAdvParte, label.lblAdvParte');
            if (adv) {
              representantes.push(adv.textContent?.trim());
            } else if (next.classList?.contains('lblParte') || next.classList?.contains('infraNomeParte')) {
              break;
            }
            next = next.nextElementSibling;
          }
          partes.push({ nome, representantes });
        });

        if (partes.length === 0) {
          const texto = td.textContent?.trim();
          if (texto) partes.push({ nome: texto.split('\n')[0].trim(), representantes: [] });
        }

        return partes;
      };

      dados.requerentes = extrairPartesColuna(celulas[0]);
      dados.requeridos  = extrairPartesColuna(celulas[1]);
    }

    const assuntoEl = document.querySelector('#fldAssuntos tr[data-assunto-principal="true"] td:nth-child(2)');
    if (assuntoEl) {
      const clone = assuntoEl.cloneNode(true);
      clone.querySelectorAll('label, a').forEach(el => el.remove());
      dados.assuntoPrincipal = clone.textContent?.trim() || '';
    }

    try {
      const hdnLoc = document.getElementById('hdnSelLocalizadoresProcesso')?.value;
      if (hdnLoc) {
        const locJson = JSON.parse(hdnLoc.replace(/'/g, '"').replace(/\\/g, '\\\\'));
        dados.localizadores = locJson.map(l => l.text).filter(Boolean);
      }
    } catch (_) {
      const locSpans = document.querySelectorAll('#dvLocalizadoresOrgao a[title="Abrir edição de localizadores"]');
      locSpans.forEach(a => {
        const texto = a.textContent?.trim();
        if (texto) dados.localizadores.push(texto);
      });
    }

    return dados;
  }

  function extrairEventos() {
    const linhas = document.querySelectorAll('#tblEventos tr[id^="trEvento"]');
    const baseUrl = window.location.href.replace(/[^/]*(\?.*)?$/, '');
    const eventos = [];

    linhas.forEach(tr => {
      const numero      = tr.id.replace('trEvento', '');
      const colunas     = tr.querySelectorAll(':scope > td');
      const dataTexto   = colunas[2]?.textContent?.trim() || '';
      const data        = dataTexto.split(' ')[0];
      const labelDescricao = tr.querySelector('.infraEventoDescricao');
      const tipo        = labelDescricao?.textContent?.trim() || '';
      const parte       = tr.dataset.parte || '';

      const linksDoc = tr.querySelectorAll('a.infraLinkDocumento');
      const documentos = Array.from(linksDoc)
        .filter(a => a.dataset.mimetype === 'pdf')
        .map(a => {
          const hrefRelativo = a.getAttribute('href') || '';
          const urlAbsoluta  = hrefRelativo.startsWith('http')
            ? hrefRelativo
            : baseUrl + hrefRelativo;
          return {
            nome:  a.dataset.nome  || a.textContent.trim(),
            label: a.textContent.trim(),
            docId: a.dataset.doc   || '',
            url:   urlAbsoluta,
          };
        });

      eventos.push({ numero, data, tipo, parte, documentos });
    });

    return eventos;
  }

  // ================================================================
  // 3. FETCH DIRETO DE PDF (3 camadas)
  // ================================================================

  async function fetchPDFDireto(urlInicial, nome) {
    const res1  = await fetch(urlInicial, { credentials: 'include' });
    const html1 = await res1.text();
    const doc1  = new DOMParser().parseFromString(html1, 'text/html');
    const iframe1 = doc1.querySelector('iframe#conteudoIframe');

    if (!iframe1?.getAttribute('src')) {
      throw new Error(`"${nome}": não encontrou iframe na camada 1.`);
    }

    const urlCamada2 = new URL(iframe1.getAttribute('src'), urlInicial).href;
    const res2 = await fetch(urlCamada2, { credentials: 'include' });
    const ct2  = res2.headers.get('content-type') || '';

    if (ct2.includes('pdf') || ct2.includes('octet')) {
      const blob2  = await res2.blob();
      const reader = new FileReader();
      return await new Promise((res, rej) => {
        reader.onload  = () => res(reader.result.split(',')[1]);
        reader.onerror = rej;
        reader.readAsDataURL(blob2);
      });
    }

    const html2  = await res2.text();
    const doc2   = new DOMParser().parseFromString(html2, 'text/html');
    const iframe2 = doc2.querySelector('iframe#conteudoIframe');

    let urlPDF;
    if (iframe2?.getAttribute('src')) {
      urlPDF = new URL(iframe2.getAttribute('src'), urlCamada2).href;
    } else {
      const match = html2.match(/url:\s*"(controlador\.php\?acao=acessar_documento_implementacao[^"]+)"/);
      if (match) {
        urlPDF = new URL(match[1].replace(/&amp;/g, '&'), urlCamada2).href;
      } else {
        throw new Error(`"${nome}": não encontrou URL do PDF na camada 2.`);
      }
    }

    const res3 = await fetch(urlPDF, { credentials: 'include' });
    const ct3  = res3.headers.get('content-type') || '';

    if (!ct3.includes('pdf') && !ct3.includes('octet')) {
      const blob3 = await res3.blob();
      throw new Error(`"${nome}": camada 3 retornou ${ct3} (${blob3.size} bytes).`);
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
  // 4. HUB DE MENSAGENS
  //
  // REGRA CRÍTICA do Chrome Extensions:
  //   O listener deve retornar `true` para manter o canal de resposta
  //   aberto quando a resposta é assíncrona (Promise/await).
  //   Retornar `undefined` ou `false` fecha o canal imediatamente —
  //   qualquer chamada posterior a responder() é silenciosamente ignorada.
  //
  //   SOLICITAR_DADOS_PROCESSO → síncrono → return false
  //   FETCH_PDF_URL            → assíncrono → return true
  // ================================================================

  chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {

    if (msg.tipo === 'SOLICITAR_DADOS_PROCESSO') {
      if (!ehPaginaDeProcesso()) {
        responder({ encontrado: false });
      } else {
        const { bruto, formatado } = extrairNumeroProcesso();
        responder({
          encontrado: true,
          payload: {
            numeroProcessoBruto:     bruto,
            numeroProcessoFormatado: formatado,
            baseUrl: window.location.href.replace(/[^/]*(\?.*)?$/, ''),
            dadosTela: extrairDadosTela(),
            eventos:   extrairEventos(),
          }
        });
      }
      return false; // síncrono — fecha o canal corretamente
    }

    if (msg.tipo === 'FETCH_PDF_URL') {
      // Assíncrono — retorna true para manter o canal aberto
      // até que fetchPDFDireto resolva e responder() seja chamado.
      fetchPDFDireto(msg.url, msg.nome)
        .then(base64 => responder({ sucesso: true, base64 }))
        .catch(erro  => responder({ sucesso: false, erro: erro.message }));
      return true; // OBRIGATÓRIO — mantém o canal de resposta aberto
    }

    return false; // default — fecha o canal para mensagens não tratadas
  });

  // ================================================================
  // 5. INICIALIZAÇÃO
  // ================================================================

  function inicializar() {
    if (!ehPaginaDeProcesso()) {
      console.debug('[Assistente eProc] Página não é de processo.');
      return;
    }

    const { bruto, formatado } = extrairNumeroProcesso();
    const eventos   = extrairEventos();
    const dadosTela = extrairDadosTela();
    const totalDocs = eventos.reduce((acc, ev) => acc + ev.documentos.length, 0);

    console.log(
      `[Assistente eProc] Processo ${formatado} | ` +
      `${eventos.length} eventos | ${totalDocs} docs PDF | ` +
      `Originário: ${dadosTela.processoOriginario || 'N/I'}`
    );

    chrome.runtime.sendMessage({
      tipo: 'PROCESSO_DETECTADO',
      payload: {
        numeroProcessoBruto:     bruto,
        numeroProcessoFormatado: formatado,
        baseUrl: window.location.href.replace(/[^/]*(\?.*)?$/, ''),
        dadosTela,
        eventos,
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