// /js/sales-overview.js
(function (window, $) {
  'use strict';

  const SalesOverview = { init, destroy };

  let ns = '.salesOverview';
  let timers = [];
  let pending = [];
  let salesTrendChart = null;
  let catSparklineChart = null;

  const REFRESH_MS = 20000;
  const REQ_TIMEOUT_MS = 15000;
  const SLOW_LOADER_DELAY_MS = 120;   // show loader quickly
  const RETRIES = 1;                  // one retry on flaky networks

  // ---- card elements (resolved at init) ----
  let $cardTrend, $cardKpi, $cardCat, $cardProd, $cardServ;

  // ---------- generic helpers ----------
  function addTimer(id) { timers.push(id); }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }
  function track(jqxhr) { pending.push(jqxhr); return jqxhr; }
  function abortAll() { pending.forEach(x => { try { x.abort(); } catch(e){} }); pending = []; }

  function destroyCharts() {
    try { salesTrendChart && salesTrendChart.destroy(); } catch(e){}
    try { catSparklineChart && catSparklineChart.destroy(); } catch(e){}
    salesTrendChart = null;
    catSparklineChart = null;
    $('#salesTrendChart, #catSparkline').empty();
  }

  // --- loader overlay ---
  function showLoader($host){
    if (!$host || !$host.length) return;
    if ($host.css('position') === 'static') $host.css('position','relative');
    if ($host.children('.card-loading').length) return;
    $host.append('<div class="card-loading"><div class="spin"></div></div>');
  }
  function hideLoader($host){ $host && $host.find('.card-loading').remove(); }

  // --- skeleton rows for tables (doesn't wipe existing content) ---
  function ensureSkeletonRows($tbody, cols, rows=3){
    if (!$tbody || !$tbody.length) return;
    if ($tbody.children('.skel-row').length) return; // already showing
    let html = '';
    for (let r=0;r<rows;r++){
      html += '<tr class="skel-row">';
      for (let c=0;c<cols;c++) html += '<td><span class="skel"></span></td>';
      html += '</tr>';
    }
    $tbody.append(html);
  }
  function clearSkeletonRows($tbody){ $tbody && $tbody.find('.skel-row').remove(); }

  // --- small fetch wrapper: timeout + retry + loader ---
// --- small fetch wrapper: timeout + retry + loader ---
// --- small fetch wrapper: timeout + retry + loader (NATIVE PROMISE) ---
function getJSONFast(url, $card){
  const delay = setTimeout(() => showLoader($card), SLOW_LOADER_DELAY_MS);

  function once(){
    return new Promise((resolve, reject) => {
      $.ajax({ url, dataType:'json', timeout: REQ_TIMEOUT_MS, cache:false })
        .done(data => resolve(data))
        .fail(err  => reject(err));
    });
  }

  let attempt = 0;
  function run(){
    attempt++;
    return once().catch(err => {
      if (attempt <= RETRIES) return run(); // retry once
      throw err; // bubble as native rejection
    });
  }

  return run()
    .finally(() => {
      clearTimeout(delay);
      hideLoader($card);
    });
}


  function bindOnce() {
    $(document)
      .off('change' + ns, '#salesTrendPreset')
      .off('apply.daterangepicker' + ns + ' cancel.daterangepicker' + ns, '#salesTrendCustom')
      .off('change' + ns, '#salesTrendYOY')
      .off('change' + ns, '#categorySelect, #categoryRangeSelect')
      .off('change' + ns, '#prodCategorySelect, #prodRangeSelect')
      .off('input'  + ns, '#prodSearchInput')
      .off('change' + ns, '#servRangeSelect');

    // Preset change
    $(document).on('change' + ns, '#salesTrendPreset', function () {
      const v = $(this).val();
      if (v === 'today') {
        $('#salesTrendCustom').hide().val('');
        loadSales('today', null, null, 'prev', null, true);
      } else if (v === 'custom') {
        $('#salesTrendCustom').show().val('');
      } else {
        $('#salesTrendCustom').hide().val('');
        loadSales(v, null, null, 'prev', null, true);
      }
    });

    // Custom range
    $(document).on('apply.daterangepicker' + ns, '#salesTrendCustom', (e, picker) => {
      const start = picker.startDate.format('YYYY-MM-DD');
      const end = picker.endDate.format('YYYY-MM-DD');
      $(e.target).val(`${start} to ${end}`);
      loadSales('custom', start, end, 'prev', null, true);
    });
    $(document).on('cancel.daterangepicker' + ns, '#salesTrendCustom', () => {
      $('#salesTrendCustom').val('');
      const preset = $('#salesTrendPreset').val();
      loadSales(preset || '7d', null, null, 'prev', null, true);
    });

    // YOY
    $(document).on('change' + ns, '#salesTrendYOY', function () {
      $('#salesTrendPreset').val('');
      $('#salesTrendCustom').hide().val('');
      const selectedYear = parseInt($(this).val(), 10);
      loadSales('year', null, null, 'yoy', selectedYear, true);
    });

    // Category + Product + Service filters
    $(document).on('change' + ns, '#categorySelect, #categoryRangeSelect', () => refreshCategoryKPIs(true));
    $(document).on('change' + ns, '#prodCategorySelect, #prodRangeSelect', () => refreshProductList(true));
    $(document).on('input'  + ns, '#prodSearchInput', () => refreshProductList(false)); // no loader for keystrokes
    $(document).on('change' + ns, '#servRangeSelect', () => refreshServiceList(true));
  }

  // ---------- public ----------
  function init() {
    if (!document.getElementById('salesOverview')) return;

    // cache card nodes once
    $cardTrend = $('#salesTrendCard');
    $cardKpi   = $('#salesKpiRow');
    $cardCat   = $('#salesByCatCard');
    $cardProd  = $('#salesByProdCard');
    $cardServ  = $('#salesByServCard');

    // YOY dropdown
    const $yoy = $('#salesTrendYOY').empty();
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y > currentYear - 5; y--) $yoy.append(`<option value="${y}">${y}-${y - 1}</option>`);

    // daterangepicker
    const $custom = $('#salesTrendCustom');
    if ($custom.data('daterangepicker')) { try { $custom.data('daterangepicker').remove(); } catch(e){} }
    $custom.daterangepicker({
      autoUpdateInput: false, opens: 'right',
      locale: { format: 'YYYY-MM-DD', cancelLabel: 'Clear' },
      alwaysShowCalendars: true, linkedCalendars: false, showDropdowns: true
    });

    bindOnce();

    // First load: show loaders immediately
    showLoader($cardKpi); showLoader($cardTrend); showLoader($cardCat); showLoader($cardProd); showLoader($cardServ);

    $('#salesTrendPreset').val('7d'); // set first
    // Run first batch mostly in parallel
    Promise.allSettled([
      loadYearKPIs(),                                 // KPI row (parallelized inside)
      loadSales('7d', null, null, 'prev', null, false),
      populateCategoryDropdown().then(() => {
        return getJSONFast('/admin/get-top-category?range=week', $cardCat)
          .then(resp => {
            const topCat = resp.topCategory;
            if (topCat) {
              $('#categorySelect').val(topCat);
              $('#prodCategorySelect').val(topCat);
              $('#categoryRangeSelect').val('week');
              $('#prodRangeSelect').val('day');
            }
          })
          .finally(() => {
            refreshCategoryKPIs(false);
            refreshProductList(false);
          });
      }),
      (function(){ $('#servRangeSelect').val('day'); return refreshServiceList(false); })()
    ]).finally(() => {
      hideLoader($cardKpi); hideLoader($cardTrend); hideLoader($cardCat); hideLoader($cardProd); hideLoader($cardServ);
    });

    // Auto refresh
    addTimer(setInterval(() => {
      if (!document.getElementById('salesOverview')) return;
      loadYearKPIs();
      const preset = $('#salesTrendPreset').val();
      const yoy = $('#salesTrendYOY').val();
      if (preset && preset !== 'custom') loadSales(preset, null, null, 'prev');
      else if (yoy) loadSales('year', null, null, 'yoy', parseInt(yoy, 10));
      refreshCategoryKPIs(false);
      refreshProductList(false);
      refreshServiceList(false);
    }, REFRESH_MS));
  }

  function destroy() {
    clearTimers();
    abortAll();
    destroyCharts();
    $(document).off(ns);
  }

  // ---------- data loaders ----------
  function loadYearKPIs() {
    // run current + previous in parallel for speed
    const today = new Date();
    const currentYear = today.getFullYear();
    const prevYear = currentYear - 1;
    const curStart = `${currentYear}-01-01`;
    const curEnd   = today.toISOString().slice(0,10);
    const prevStart = `${prevYear}-01-01`;
    const prevEnd   = `${prevYear}-12-31`;

    showLoader($cardKpi);

    const curReq  = getJSONFast(`/admin/get-dashboard-stats?range=custom&start=${curStart}&end=${curEnd}&compare=none`, $cardKpi);
    const prevReq = getJSONFast(`/admin/get-dashboard-stats?range=custom&start=${prevStart}&end=${prevEnd}&compare=none`, $cardKpi);

    return Promise.allSettled([curReq, prevReq]).then(([curRes, prevRes]) => {
      const curData  = curRes.status === 'fulfilled' ? curRes.value : {};
      const prevData = prevRes.status === 'fulfilled' ? prevRes.value : {};

      const curRev = curData.sales?.totalRevenue || 0;
      const curTxns = curData.sales?.totalTransactions || 0;
      const prevRev = prevData.sales?.totalRevenue || 0;

      $('#kpiRevenue').text('₱' + curRev.toLocaleString());
      $('#kpiTxns').text(curTxns);
      $('#kpiAov').text('₱' + prevRev.toLocaleString());

      let revPctChange = 0;
      if (prevRev > 0) revPctChange = ((curRev - prevRev) / prevRev) * 100;
      const revPctRounded = parseFloat(revPctChange.toFixed(1));
      const convText = (revPctRounded >= 0 ? '+' : '') + `${revPctRounded}%`;
      $('#kpiConv').text(convText)
        .toggleClass('up', revPctRounded > 0)
        .toggleClass('down', revPctRounded < 0)
        .toggleClass('neutral', revPctRounded === 0);

      const $growthIcon = $('#growthIcon').removeClass('up down neutral fa-arrow-up fa-arrow-down');
      if (revPctRounded > 0) $growthIcon.addClass('up fa-arrow-up');
      else if (revPctRounded < 0) $growthIcon.addClass('down fa-arrow-down');
      else $growthIcon.addClass('neutral fa-arrow-down');
    }).catch(() => {
      $('#kpiRevenue').text('₱0');
      $('#kpiTxns').text(0);
      $('#kpiAov').text('₱0');
      $('#kpiConv').text('0%').removeClass('up down').addClass('neutral');
      $('#growthIcon').removeClass('up down').addClass('neutral fa-arrow-down');
    }).finally(() => hideLoader($cardKpi));
  }

  // showLoaderOnStart: true when user changes filters (so we force overlay instantly)
  function loadSales(range, start, end, compare, year, showLoaderOnStart=false) {
    if (showLoaderOnStart) showLoader($cardTrend);

    // YOY (two calls in parallel)
    if (compare === 'yoy' && typeof year === 'number') {
      const curStart = `${year}-01-01`, curEnd = `${year}-12-31`;
      const prevStart = `${year-1}-01-01`, prevEnd = `${year-1}-12-31`;

      return Promise.allSettled([
        getJSONFast(`/admin/get-dashboard-stats?range=custom&start=${curStart}&end=${curEnd}&compare=none`, $cardTrend),
        getJSONFast(`/admin/get-dashboard-stats?range=custom&start=${prevStart}&end=${prevEnd}&compare=none`, $cardTrend)
      ]).then(([curRes, prevRes]) => {
        const curData = curRes.status==='fulfilled' ? curRes.value : {};
        const prevData= prevRes.status==='fulfilled' ? prevRes.value : {};
        // (render the same as your original)
        const curSales  = curData.sales?.totalRevenue || 0;
        const prevSales = prevData.sales?.totalRevenue || 0;
        const curTxns   = curData.sales?.totalTransactions || 0;
        const prevTxns  = prevData.sales?.totalTransactions || 0;
        const curProfit = curData.sales?.profit || 0;
        const prevProfit= prevData.sales?.profit || 0;

        let pctGrowth = 0;
        if (prevSales > 0) pctGrowth = ((curSales - prevSales) / prevSales) * 100;
        const pctRounded = pctGrowth.toFixed(1);

        destroyCharts();
        $('#salesTrendKPITable').show();
        $('#stCurLabel').text(`${year}`);
        $('#stPrevLabel').text(`${year-1}`);
        $('#stCurSales').text(`₱${curSales.toLocaleString()}`);
        $('#stCurTxns').text(curTxns);
        $('#stCurProfit').text(`₱${curProfit.toLocaleString()}`);
        $('#stPrevSales').text(`₱${prevSales.toLocaleString()}`);
        $('#stPrevTxns').text(prevTxns);
        $('#stPrevProfit').text(`₱${prevProfit.toLocaleString()}`);

        salesTrendChart = new ApexCharts(document.querySelector('#salesTrendChart'), {
          chart: { type: 'bar', height: 320, toolbar: { show: false } },
          series: [
            { name: 'Sales (₱)', data: [curSales, prevSales] },
            { name: 'Transactions', data: [curTxns, prevTxns] },
            { name: 'Profit (₱)', data: [curProfit, prevProfit] }
          ],
          xaxis: { categories: [`${year}`, `${year-1}`], labels:{ style:{ fontSize:'13px' } } },
          yaxis: { labels: { formatter: v => Number(v.toFixed(0)).toLocaleString() } },
          colors: ['#008FFB', '#FEB019', '#28A745'],
          plotOptions: { bar: { columnWidth: '45%', dataLabels: { position: 'top' } } },
          dataLabels: {
            enabled:true, offsetY:-28, style:{ colors:['#222'], fontWeight:700, fontSize:'15px' },
            background:{ enabled:true, foreColor:'#fff', borderRadius:4, opacity:0.95, padding:3 },
            formatter:(val, opts)=> (opts.seriesIndex===0 && opts.dataPointIndex===0)
              ? `₱${Number(val).toLocaleString()}\n${pctGrowth >= 0 ? '+' : ''}${pctRounded}%`
              : (opts.seriesIndex===1 ? `${Number(val).toLocaleString()}` : `₱${Number(val).toLocaleString()}`)
          },
          legend:{ show:true, position:'top', horizontalAlign:'right' },
          tooltip:{ y:(v,o)=> (o.seriesIndex===1 ? `${Number(v).toLocaleString()}` : `₱${Number(v).toLocaleString()}`) }
        });
        salesTrendChart.render();
      }).catch(renderTrendZero).finally(() => hideLoader($cardTrend));
    }

    // other ranges
    let qs = `?range=${range}&compare=${compare}`;
    if (range === 'custom') qs += `&start=${start}&end=${end}`;
    return getJSONFast(`/admin/get-dashboard-stats${qs}`, $cardTrend)
      .then(renderTrendFromApi)
      .catch(renderTrendZero)
      .finally(() => hideLoader($cardTrend));

    function renderTrendFromApi(data){ /* unchanged from your version */ 
      const s = data.sales || {};
      destroyCharts();
      let curLabel = 'Current', prevLabel = 'Previous';
      const now = moment().endOf('day');
      if (compare === 'prev') {
        if (range === '7d') {
          const curFrom = now.clone().subtract(6,'days').startOf('day');
          const prevTo  = curFrom.clone().subtract(1,'day').endOf('day');
          const prevFrom= prevTo.clone().subtract(6,'days').startOf('day');
          curLabel = `${curFrom.format('MMM D')} – ${now.format('MMM D')}`;
          prevLabel= `${prevFrom.format('MMM D')} – ${prevTo.format('MMM D')}`;
        } else if (range === '30d') {
          const curFrom = now.clone().subtract(29,'days').startOf('day');
          const prevTo  = curFrom.clone().subtract(1,'day').endOf('day');
          const prevFrom= prevTo.clone().subtract(29,'days').startOf('day');
          curLabel = `${curFrom.format('MMM D')} – ${now.format('MMM D')}`;
          prevLabel= `${prevFrom.format('MMM D')} – ${prevTo.format('MMM D')}`;
        } else if (range === 'month') {
          const curFrom = moment().startOf('month');
          const prevFrom= curFrom.clone().subtract(1,'month').startOf('month');
          const prevTo  = now.clone().subtract(1,'month');
          curLabel = `${curFrom.format('MMM D')} – ${now.format('MMM D')}`;
          prevLabel= `${prevFrom.format('MMM D')} – ${prevTo.format('MMM D')}`;
        } else if (range === 'year') {
          const curFrom = moment().startOf('year');
          const prevFrom= curFrom.clone().subtract(1,'year').startOf('year');
          const prevTo  = now.clone().subtract(1,'year');
          curLabel = `${curFrom.format('MMM D')} – ${now.format('MMM D')}`;
          prevLabel= `${prevFrom.format('MMM D')} – ${prevTo.format('MMM D')}`;
        } else if (range === 'custom' && start && end) {
          const curFrom = moment(start,'YYYY-MM-DD').startOf('day');
          const curTo   = moment(end,'YYYY-MM-DD').endOf('day');
          const dayCount= curTo.diff(curFrom,'days')+1;
          const prevTo  = curFrom.clone().subtract(1,'day').endOf('day');
          const prevFrom= prevTo.clone().subtract(dayCount-1,'days').startOf('day');
          curLabel = `${curFrom.format('MMM D')} – ${curTo.format('MMM D')}`;
          prevLabel= `${prevFrom.format('MMM D')} – ${prevTo.format('MMM D')}`;
        }
      }

      const currentRev = s.totalRevenue || 0;
      const previousRev = s.comparison?.prevRevenue || 0;
      const currentTxns = s.totalTransactions || 0;
      const previousTxns = s.comparison?.prevTransactions || 0;
      const currentProfit= s.profit || 0;
      const previousProfit= s.comparison?.prevProfit || 0;

      let pctGrowth = 0;
      if (previousRev > 0) pctGrowth = ((currentRev - previousRev) / previousRev) * 100;
      const pctRounded = pctGrowth.toFixed(1);

      salesTrendChart = new ApexCharts(document.querySelector('#salesTrendChart'), {
        chart:{ type:'bar', height:320, toolbar:{ show:false } },
        series:[
          { name:'Sales (₱)', data:[currentRev, previousRev] },
          { name:'Transactions', data:[currentTxns, previousTxns] },
          { name:'Profit (₱)', data:[currentProfit, previousProfit] }
        ],
        xaxis:{ categories:[curLabel, prevLabel], labels:{ style:{ fontSize:'13px'} } },
        yaxis:{ labels:{ formatter:val=> Number(val.toFixed(0)).toLocaleString() } },
        colors:['#008FFB','#FEB019','#28A745'],
        plotOptions:{ bar:{ columnWidth:'45%', dataLabels:{ position:'top' } } },
        dataLabels:{
          enabled:true, offsetY:-28, style:{ colors:['#222'], fontWeight:700, fontSize:'15px' },
          background:{ enabled:true, foreColor:'#fff', borderRadius:4, opacity:0.95, padding:3 },
          formatter:(val,opts)=> (opts.seriesIndex===0 && opts.dataPointIndex===0)
            ? `₱${Number(val).toLocaleString()}\n${pctGrowth>=0?'+':''}${pctRounded}%`
            : (opts.seriesIndex===1 ? `${Number(val).toLocaleString()}` : `₱${Number(val).toLocaleString()}`)
        },
        legend:{ show:true, position:'top', horizontalAlign:'right' },
        tooltip:{ y:(v,o)=> (o.seriesIndex===1 ? `${Number(v).toLocaleString()}` : `₱${Number(v).toLocaleString()}`) }
      });
      salesTrendChart.render();

      $('#salesTrendKPITable').show();
      $('#stCurLabel').text(curLabel);
      $('#stPrevLabel').text(prevLabel);
      $('#stCurSales').text(`₱${currentRev.toLocaleString()}`);
      $('#stCurTxns').text(currentTxns);
      $('#stCurProfit').text(`₱${currentProfit.toLocaleString()}`);
      $('#stPrevSales').text(`₱${previousRev.toLocaleString()}`);
      $('#stPrevTxns').text(previousTxns);
      $('#stPrevProfit').text(`₱${previousProfit.toLocaleString()}`);
    }

    function renderTrendZero(){
      $('#salesTrendKPITable').show();
      $('#stCurLabel').text('Current'); $('#stPrevLabel').text('Previous');
      $('#stCurSales, #stPrevSales, #stCurProfit, #stPrevProfit').text('₱0');
      $('#stCurTxns, #stPrevTxns').text('0');
      destroyCharts();
      salesTrendChart = new ApexCharts(document.querySelector('#salesTrendChart'), {
        chart:{ type:'bar', height:320, toolbar:{ show:false } },
        series:[ {name:'Sales (₱)', data:[0,0]}, {name:'Transactions', data:[0,0]}, {name:'Profit (₱)', data:[0,0]} ],
        xaxis:{ categories:['Current','Previous'] }, legend:{ show:false }, dataLabels:{ enabled:false }
      });
      salesTrendChart.render();
    }
  }

  function refreshCategoryKPIs(forceLoader){
    const category = $('#categorySelect').val();
    const range = $('#categoryRangeSelect').val() || 'week';
    if (!category){
      $('#catSales, #catProfit, #catLoss').text('₱0');
      $('#catRate').text('0%'); $('#catComparisonText').text('');
      $('#catGrowth').removeClass('up down').addClass('neutral')
        .html('<span>0%</span><span class="arrow">&#8594;</span><small class="ml-2 text-muted">vs. previous period</small>');
      try { catSparklineChart && catSparklineChart.destroy(); } catch(e){}
      $('#catSparkline').html(''); return;
    }
    if (forceLoader) showLoader($cardCat);

    return getJSONFast(`/admin/get-sales-by-category?category=${encodeURIComponent(category)}&range=${encodeURIComponent(range)}`, $cardCat)
      .then(data => {
        const rev    = Number(data.totalRevenue)         || 0;
        const loss   = Number(data.totalExpiredFullLoss) || 0;
        const profit = Number(data.profit)               || 0;
        const fmtPeso = n => (n < 0 ? `-₱${Math.abs(n).toLocaleString()}` : `₱${Number(n).toLocaleString()}`);

        $('#catSales').text(fmtPeso(rev));
        $('#catProfit').text(fmtPeso(profit));
        $('#catLoss').text(fmtPeso(loss));

        const lastRev = Number(data.lastPeriodRevenue) || 0;
        let pctGrowth = 0; if (lastRev > 0) pctGrowth = ((rev - lastRev) / lastRev) * 100;
        const pctRounded = parseFloat(pctGrowth.toFixed(1));

        $('#catRate').text((pctRounded >= 0 ? '+' : '') + `${pctRounded}%`);
        const $gl = $('#catGrowth').removeClass('up down neutral');
        if (pctRounded > 0) $gl.addClass('up').html(`<span>+${pctRounded}%</span><span class="arrow">&#8599;</span><small class="ml-2 text-muted">vs. previous period</small>`);
        else if (pctRounded < 0) $gl.addClass('down').html(`<span>${pctRounded}%</span><span class="arrow">&#8600;</span><small class="ml-2 text-muted">vs. previous period</small>`);
        else $gl.addClass('neutral').html(`<span>0%</span><span class="arrow">&#8594;</span><small class="ml-2 text-muted">vs. previous period</small>`);

        try { catSparklineChart && catSparklineChart.destroy(); } catch(e){}
        $('#catSparkline').html('');
        catSparklineChart = new ApexCharts(document.querySelector('#catSparkline'), {
          chart:{ type:'line', height:20, width:50, sparkline:{ enabled:true } },
          series:[{ data:[lastRev, rev] }], stroke:{ curve:'smooth', width:2 },
          colors:[pctRounded > 0 ? '#28a745' : '#e74c3c'], tooltip:{ enabled:false }
        });
        catSparklineChart.render();

        const map = { day:['today','yesterday'], week:['the last 7 days','the previous 7 days'], month:['this month','last month'], year:['this year','last year'] };
        const [curTxt, prevTxt] = map[range] || ['current period','previous period'];
        $('#catComparisonText').text(pctRounded>0 ? `Your ${curTxt} sales are higher than ${prevTxt}.`
          : pctRounded<0 ? `Your ${curTxt} sales are lower than ${prevTxt}.` : `Your ${curTxt} sales are the same as ${prevTxt}.`);
      })
      .catch(() => {
        $('#catSales, #catProfit, #catLoss').text('₱0');
        $('#catRate').text('0%'); $('#catComparisonText').text('');
        $('#catGrowth').removeClass('up down').addClass('neutral')
          .html('<span>0%</span><span class="arrow">&#8594;</span><small class="ml-2 text-muted">vs. previous period</small>');
        try { catSparklineChart && catSparklineChart.destroy(); } catch(e){}
        $('#catSparkline').html('');
      })
      .finally(() => hideLoader($cardCat));
  }

  function refreshProductList(forceLoader){
    const category = $('#prodCategorySelect').val() || '';
    const range = $('#prodRangeSelect').val() || 'day';
    const searchTerm = ($('#prodSearchInput').val() || '').toLowerCase();
    const $tbody = $('#salesByProdTable tbody'); // don't empty immediately: keep last data
    $('#prodNoData').hide();
    if (forceLoader) { showLoader($cardProd); ensureSkeletonRows($tbody, 3, 5); }

    return getJSONFast(`/admin/get-sales-by-product?category=${encodeURIComponent(category)}&range=${encodeURIComponent(range)}`, $cardProd)
      .then(data => {
        let items = data.products || [];
        if (searchTerm) items = items.filter(i => (i.productName || '').toLowerCase().includes(searchTerm));
        $tbody.empty();
        if (!items.length) { $('#prodNoData').show(); return; }
        items.forEach(item => {
          const units = item.unitsSold || 0;
          const rev = item.revenue || 0;
          $tbody.append(`<tr><td>${item.productName}</td><td class="text-right">${units.toLocaleString()}</td><td class="text-right">₱${rev.toLocaleString()}</td></tr>`);
        });
      })
      .catch(() => { $('#prodNoData').text('Error loading products.').show(); })
      .finally(() => { clearSkeletonRows($tbody); hideLoader($cardProd); });
  }

  function refreshServiceList(forceLoader){
    const range = $('#servRangeSelect').val() || 'day';
    const $tbody = $('#salesByServTable tbody'); // keep old data until new arrives
    $('#servNoData').hide();
    if (forceLoader) { showLoader($cardServ); ensureSkeletonRows($tbody, 3, 5); }

    return getJSONFast(`/admin/get-sales-by-service?range=${encodeURIComponent(range)}`, $cardServ)
      .then(data => {
        const items = data.services || [];
        $tbody.empty();
        if (!items.length) { $('#servNoData').show(); return; }
        items.forEach(item => {
          const count = item.unitsSold || 0;
          const rev = item.revenue || 0;
          $tbody.append(`<tr><td>${item.serviceName}</td><td class="text-right">${count.toLocaleString()}</td><td class="text-right">₱${rev.toLocaleString()}</td></tr>`);
        });
      })
      .catch(() => $('#servNoData').text('Error loading data.').show())
      .finally(() => { clearSkeletonRows($tbody); hideLoader($cardServ); });
  }

  function populateCategoryDropdown(){
    const $catSel = $('#categorySelect');
    const $prodCatSel = $('#prodCategorySelect');
    const $expiredCatSel = $('#expiredCategorySelect');
    const prevCat = $catSel.val();
    const prevProdCat = $prodCatSel.val();
    const prevExpiredCat = $expiredCatSel.val();

    $catSel.empty().append('<option value="" disabled selected>Select Category</option>');
    $prodCatSel.empty().append('<option value="">All Categories</option>');
    if ($expiredCatSel.length) $expiredCatSel.empty().append('<option value="">All Categories</option>');

    return getJSONFast('/admin/get-categories', $cardCat)
      .then((categories=[]) => {
        const list = categories.filter(c => typeof c==='string' && c.trim().length).map(c=>c.trim()).sort((a,b)=>a.localeCompare(b));
        list.forEach(cat => {
          const t = cat.charAt(0).toUpperCase() + cat.slice(1);
          $catSel.append(`<option value="${cat}">${t}</option>`);
          $prodCatSel.append(`<option value="${cat}">${t}</option>`);
          if ($expiredCatSel.length) $expiredCatSel.append(`<option value="${cat}">${t}</option>`);
        });
        if (prevCat && list.includes(prevCat)) $catSel.val(prevCat);
        if (prevProdCat === '' || list.includes(prevProdCat)) $prodCatSel.val(prevProdCat);
        if ($expiredCatSel.length && (prevExpiredCat === '' || list.includes(prevExpiredCat))) {
          $expiredCatSel.val(prevExpiredCat);
        }
      })
      .catch(() => console.warn('Failed to load categories.'));
  }

  window.SalesOverview = SalesOverview;
})(window, jQuery);
