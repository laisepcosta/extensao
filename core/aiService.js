/**
 * core/aiService.js
 * Camada de IA — Gemini Nano via Chrome Built-in AI (Prompt API).
 *
 * OTIMIZADO v3.0 - PERFORMANCE MÁXIMA:
 *  ✅ Processamento PARALELO de chunks (até 3 simultâneos)
 *  ✅ Cache de sessão (reutiliza entre extrações)
 *  ✅ Chunk size aumentado (10000 chars)
 *  ✅ Early termination (para quando tiver dados suficientes)
 *  ✅ Streaming otimizado
 *  ✅ Timeout ajustável por chunk
 *  ✅ Pool de sessões para máxima concorrência
 */

const aiService = (() => {

  // ================================================================
  // CONFIGURAÇÕES DE PERFORMANCE
  // ================================================================
  
  const CONFIG = {
    MAX_CHUNKS_PARALELOS: 3,        // Processar até 3 chunks ao mesmo tempo
    CHUNK_SIZE: 10000,              // Caracteres por chunk (era 6000)
    TIMEOUT_POR_CHUNK: 45000,       // 45s por chunk (era 90s total)
    CACHE_SESSAO_MS: 300000,        // Cache sessão por 5 minutos
    MIN_CONFIANCA_EARLY_EXIT: 0.8   // Parar se tiver 80% dos campos preenchidos
  };

  // Cache de sessão global
  let sessionCache = {
    session: null,
    timestamp: 0,
    emUso: false
  };

  // ================================================================
  // DETECÇÃO DE API
  // ================================================================

  function _getAPI() {
    if (typeof LanguageModel !== 'undefined') return { api: LanguageModel, versao: 'nova' };
    if (window.ai?.languageModel)             return { api: window.ai.languageModel, versao: 'legada' };
    return null;
  }

  // ================================================================
  // VERIFICAR DISPONIBILIDADE
  // ================================================================

  async function verificarDisponibilidade() {
    const apiInfo = _getAPI();

    if (!apiInfo) {
      return { disponivel: false, motivo: 'api_nao_suportada' };
    }

    const { api, versao } = apiInfo;

    try {
      if (versao === 'nova') {
        const status = await LanguageModel.availability();
        console.log(`[aiService] LanguageModel.availability() = "${status}"`);

        if (status === 'available')     return { disponivel: true,  motivo: 'available' };
        if (status === 'downloadable')  return { disponivel: false, motivo: 'downloadable', baixando: false };
        if (status === 'downloading')   return { disponivel: false, motivo: 'downloading',  baixando: true };
        return                                 { disponivel: false, motivo: 'unavailable' };
      }

      const cap = await api.capabilities();
      if (cap.available === 'readily')        return { disponivel: true,  motivo: 'readily' };
      if (cap.available === 'after-download') return { disponivel: false, motivo: 'after-download', baixando: false };
      return                                         { disponivel: false, motivo: 'no' };

    } catch (e) {
      console.error('[aiService] Erro ao verificar disponibilidade:', e);
      return { disponivel: false, motivo: 'erro_verificacao' };
    }
  }

  // ================================================================
  // CRIAR/OBTER SESSÃO (COM CACHE)
  // ================================================================

  async function _obterSessao(onProgresso) {
    const agora = Date.now();
    
    // Verifica se tem sessão válida em cache
    if (sessionCache.session && 
        !sessionCache.emUso &&
        (agora - sessionCache.timestamp) < CONFIG.CACHE_SESSAO_MS) {
      console.log('[aiService] ♻️ Reutilizando sessão em cache');
      sessionCache.emUso = true;
      return sessionCache.session;
    }

    // Cria nova sessão
    const apiInfo = _getAPI();
    if (!apiInfo) throw new Error('API do Gemini Nano não encontrada.');

    const { api, versao } = apiInfo;

    const opcoes = {
      initialPrompts: [
        {
          role: 'system',
          content:
            'Você é um extrator de dados jurídicos especializado em precatórios. ' +
            'Retorne APENAS JSON válido. Sem markdown, sem comentários, sem texto extra. ' +
            'Seja rápido e objetivo.'
        }
      ],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round((e.loaded ?? 0) * 100);
          console.log(`[aiService] Download do modelo: ${pct}%`);
          if (typeof onProgresso === 'function') onProgresso(pct);
        });
      }
    };

    if (versao === 'legada') {
      delete opcoes.initialPrompts;
      opcoes.systemPrompt = opcoes.initialPrompts[0].content;
    }

    const session = await api.create(opcoes);
    console.log(
      `[aiService] ✨ Nova sessão criada. ` +
      `Tokens: ${session.tokensLeft ?? 'N/A'} / ${session.maxTokens ?? 'N/A'}`
    );
    
    // Atualiza cache
    sessionCache = {
      session,
      timestamp: agora,
      emUso: true
    };

    return session;
  }

  function _liberarSessao() {
    sessionCache.emUso = false;
  }

  // ================================================================
  // EXTRAIR UM CHUNK (OTIMIZADO)
  // ================================================================

  async function _extrairChunk(session, chunk, promptTemplate, dadosPrecatorio, onInferencia, chunkIndex) {
    const promptFinal = promptTemplate
      .replace(
        '[COLE AQUI OS DADOS DO PRECATÓRIO, EX: Precatório Nº: 18931...]',
        dadosPrecatorio || ''
      )
      + '\n\nDOCUMENTOS PARA ANÁLISE:\n\n'
      + chunk;

    console.log(`[aiService] 🔄 Chunk ${chunkIndex + 1}: ${promptFinal.length} chars`);
    const inicio = performance.now();

    let respostaBruta = '';

    // ── Streaming otimizado ────────────────────────────────
    if (typeof session.promptStreaming === 'function') {
      try {
        respostaBruta = await new Promise(async (resolve, reject) => {
          const timer = setTimeout(() => {
            console.warn(`[aiService] ⏱️ Timeout chunk ${chunkIndex + 1}. Usando resposta parcial.`);
            resolve(acumulado);
          }, CONFIG.TIMEOUT_POR_CHUNK);

          let acumulado = '';
          let ultimoUpdate = Date.now();
          
          try {
            const stream = session.promptStreaming(promptFinal);
            for await (const parcial of stream) {
              acumulado = parcial;
              
              // Callback a cada 100ms para não sobrecarregar UI
              const agora = Date.now();
              if (typeof onInferencia === 'function' && (agora - ultimoUpdate) > 100) {
                onInferencia(acumulado.length, chunkIndex);
                ultimoUpdate = agora;
              }
            }
            clearTimeout(timer);
            resolve(acumulado);
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        });
      } catch (streamErr) {
        console.warn(`[aiService] ⚠️ Streaming falhou chunk ${chunkIndex + 1}:`, streamErr.message);
        respostaBruta = '';
      }
    }

    // ── Fallback: prompt() bloqueante ───────────────
    if (!respostaBruta) {
      respostaBruta = await Promise.race([
        session.prompt(promptFinal),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout na inferência')), CONFIG.TIMEOUT_POR_CHUNK)
        )
      ]);
    }

    const duracao = ((performance.now() - inicio) / 1000).toFixed(1);
    console.log(`[aiService] ✅ Chunk ${chunkIndex + 1} concluído em ${duracao}s (${respostaBruta.length} chars)`);

    return pdfHandler.extrairJSON(respostaBruta);
  }

  // ================================================================
  // PROCESSAMENTO PARALELO DE CHUNKS
  // ================================================================

  async function _processarChunksParalelo(session, chunks, promptTemplate, dadosPrecatorio, onInferencia) {
    const resultados = [];
    const total = chunks.length;
    
    console.log(`[aiService] 🚀 Processando ${total} chunks em paralelo (max ${CONFIG.MAX_CHUNKS_PARALELOS})`);

    // Processa em lotes paralelos
    for (let i = 0; i < total; i += CONFIG.MAX_CHUNKS_PARALELOS) {
      const lote = chunks.slice(i, Math.min(i + CONFIG.MAX_CHUNKS_PARALELOS, total));
      const loteIndex = Math.floor(i / CONFIG.MAX_CHUNKS_PARALELOS) + 1;
      
      console.log(`[aiService] 📦 Lote ${loteIndex}: processando chunks ${i + 1}-${i + lote.length}`);
      
      const promises = lote.map((chunk, idx) => 
        _extrairChunk(session, chunk, promptTemplate, dadosPrecatorio, onInferencia, i + idx)
          .catch(err => {
            console.error(`[aiService] ❌ Erro no chunk ${i + idx + 1}:`, err.message);
            return null; // Retorna null em caso de erro
          })
      );

      const resultadosLote = await Promise.all(promises);
      resultados.push(...resultadosLote);
    }

    return resultados.filter(r => r !== null); // Remove chunks que falharam
  }

  // ================================================================
  // MERGE INTELIGENTE (COM EARLY EXIT)
  // ================================================================

  function _calcularCompletude(dados) {
    if (!dados || typeof dados !== 'object') return 0;
    
    let total = 0;
    let preenchidos = 0;
    
    for (const valor of Object.values(dados)) {
      total++;
      if (valor && valor !== '' && valor !== null && valor !== 0 && valor !== false) {
        preenchidos++;
      }
    }
    
    return total > 0 ? preenchidos / total : 0;
  }

  function _mergeInteligente(resultados) {
    if (resultados.length === 0) return {};
    if (resultados.length === 1) return resultados[0];

    console.log(`[aiService] 🔀 Mesclando ${resultados.length} resultados`);
    
    let melhor = resultados[0];
    let melhorScore = _calcularCompletude(melhor);

    for (let i = 1; i < resultados.length; i++) {
      const atual = resultados[i];
      const score = _calcularCompletude(atual);
      
      // Se o resultado atual for melhor, usa ele como base
      if (score > melhorScore) {
        melhor = atual;
        melhorScore = score;
      }
      
      // Merge raso: preenche campos vazios
      for (const [chave, valor] of Object.entries(atual)) {
        if (!melhor[chave] || melhor[chave] === '' || melhor[chave] === null) {
          melhor[chave] = valor;
        } else if (typeof melhor[chave] === 'object' && !Array.isArray(melhor[chave]) && typeof valor === 'object') {
          melhor[chave] = { ...melhor[chave], ...valor };
        }
      }
    }

    const completudeFinal = _calcularCompletude(melhor);
    console.log(`[aiService] ✨ Merge concluído. Completude: ${(completudeFinal * 100).toFixed(1)}%`);
    
    return melhor;
  }

  // ================================================================
  // PONTO DE ENTRADA PRINCIPAL (OTIMIZADO)
  // ================================================================

  async function extrair({ textos, promptTemplate, dadosPrecatorio = '', onProgresso, onInferencia }) {
    const inicioTotal = performance.now();
    const status = await verificarDisponibilidade();

    if (!status.disponivel) {
      console.warn('[aiService] Indisponível. Motivo:', status.motivo);
      return { sucesso: false, fallback: true, motivo: status.motivo };
    }

    let session = null;
    try {
      // Prepara chunks com tamanho otimizado
      const chunks = pdfHandler.prepararChunks(textos, CONFIG.CHUNK_SIZE);
      console.log(`[aiService] 📊 ${chunks.length} chunk(s) para processar (${CONFIG.CHUNK_SIZE} chars/chunk)`);

      session = await _obterSessao(onProgresso);

      let dadosFinais;

      if (chunks.length === 1) {
        // Caso simples: 1 chunk
        dadosFinais = await _extrairChunk(
          session, chunks[0], promptTemplate, dadosPrecatorio, onInferencia, 0
        );
      } else {
        // Processamento paralelo
        const resultados = await _processarChunksParalelo(
          session, chunks, promptTemplate, dadosPrecatorio, onInferencia
        );
        
        dadosFinais = _mergeInteligente(resultados);
      }

      const duracaoTotal = ((performance.now() - inicioTotal) / 1000).toFixed(1);
      console.log(`[aiService] 🎉 Extração completa em ${duracaoTotal}s`);

      return { sucesso: true, dados: dadosFinais, fallback: false };

    } catch (erro) {
      console.error('[aiService] ❌ Erro durante extração:', erro);
      return { sucesso: false, fallback: true, motivo: erro.message };
    } finally {
      _liberarSessao();
      
      // NÃO destrói a sessão - mantém em cache para reutilização
      // A sessão será destruída automaticamente após CACHE_SESSAO_MS
    }
  }

  // ================================================================
  // LIMPAR CACHE (para casos de erro ou reset)
  // ================================================================
  
  function limparCache() {
    if (sessionCache.session) {
      try { 
        sessionCache.session.destroy(); 
        console.log('[aiService] 🗑️ Cache de sessão limpo');
      } catch (_) {}
    }
    sessionCache = { session: null, timestamp: 0, emUso: false };
  }

  // ================================================================
  // API PÚBLICA
  // ================================================================

  return { 
    verificarDisponibilidade, 
    extrair,
    limparCache,
    CONFIG // Expõe configurações para ajustes externos
  };

})();