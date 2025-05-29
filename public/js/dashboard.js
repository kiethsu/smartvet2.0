let serviceRevenueChartInstance = null;
let salesTrendChart;
let stockByCategoryChartInstance = null;
let valueByCategoryChartInstance = null;
let appointmentTrendChart = null;

// -------- Helper function for percent arrows --------
function setChange(selector, percent) {
  const el = $(selector);
  el.removeClass('up down neutral');
  if (percent > 0) {
    el.addClass('up').html(`<span>+${percent}%</span><span class="arrow">&#8599;</span>`);
  } else if (percent < 0) {
    el.addClass('down').html(`<span>${percent}%</span><span class="arrow">&#8600;</span>`);
  } else {
    el.addClass('neutral').html(`<span>0%</span><span class="arrow">&#8594;</span>`);
  }
}

$(function(){
  // --- Date Range Picker for Sales ---
  $('#customRange').daterangepicker({
    autoUpdateInput: false,
    opens: 'left',
    locale: { cancelLabel: 'Clear' }
  })
  .on('apply.daterangepicker', (e, picker) => {
    const start = picker.startDate.format('YYYY-MM-DD');
    const end   = picker.endDate.format('YYYY-MM-DD');
    $(e.target).val(`${start} to ${end}`);
    loadSales('custom', start, end, $('#compareMode').val());
  })
  .on('cancel.daterangepicker', e => {
    $(e.target).val('');
    loadSales($('#presetRange').val(), null, null, $('#compareMode').val());
  });

  $('#presetRange, #compareMode').on('change', () => {
    loadSales($('#presetRange').val(), null, null, $('#compareMode').val());
  });

  // --- Inventory Range Filter ---
  $('#inventoryRange').on('change', () => {
    loadInventoryOverview($('#inventoryRange').val());
  });

  // --- Service Revenue Filter ---
  $('#serviceRevenueRange').on('change', function() {
    loadRevenueByService($(this).val());
  });

  // --- Initial Loads ---
  loadSales('7d', null, null, 'prev');
  loadInventoryOverview();
  loadRevenueByService(); // default '7d'
});


// ----- SALES -----
function loadSales(range, start, end, compare) {
  let qs = `?range=${range}&compare=${compare}`;
  if (range === 'custom') qs += `&start=${start}&end=${end}`;

  $.getJSON(`/admin/get-dashboard-stats${qs}`)
    .done(data => {
      const s = data.sales || {};
      const u = data.userStats || {};

      // ---- KPI cards ----
      $('#kpiRevenue').text('₱' + (s.totalRevenue||0).toLocaleString());
      $('#kpiTxns').text(s.totalTransactions||0);
      const avg = s.totalTransactions ? s.totalRevenue/s.totalTransactions : 0;
      $('#kpiAov').text('₱' + Math.round(avg).toLocaleString());
      const conv = u.customers ? (s.totalTransactions/u.customers*100) : 0;
      $('#kpiConv').text(conv.toFixed(1) + '%');
      $('#kpiRevChange').text(
        (s.comparison?.revenueChangePercent>=0?'+':'') +
        (s.comparison?.revenueChangePercent||0).toFixed(1) + '%'
      );
      $('#kpiTxnChange').text(
        (s.comparison?.transactionsChangePercent>=0?'+':'') +
        (s.comparison?.transactionsChangePercent||0).toFixed(1) + '%'
      );

      // ---- User Stats Card (with arrow and percent change) ----
      let doctorsChange = (u.doctorsChange !== undefined) ? u.doctorsChange : 0;
      let hrChange = (u.hrChange !== undefined) ? u.hrChange : 0;
      let customersChange = (u.customersChange !== undefined) ? u.customersChange : 0;
      let retentionPercent = data.descriptive 
        ? ((data.descriptive.returningCustomers || 0) / 
            ((data.descriptive.newCustomers || 0) + (data.descriptive.returningCustomers || 0)) * 100).toFixed(1)
        : 0;

      $('#doctorsCountSmall').text(u.doctors || 0);
      $('#hrCountSmall').text(u.hr || 0);
      $('#customersCountSmall').text(u.customers || 0);

      setChange('#doctorsChange', doctorsChange);
      setChange('#hrChange', hrChange);
      setChange('#customersChange', customersChange);
      setChange('#kpiRetPct', retentionPercent);

      // ---- Sales Trend Chart ----
      if (salesTrendChart) {
        salesTrendChart.destroy();
        $('#salesTrendChart').html('');
      }
      if (s.trend?.data && s.trend?.data.some(v=>v>0)) {
        salesTrendChart = new ApexCharts(
          document.querySelector('#salesTrendChart'),
          {
            chart: { type:'line', height:300, toolbar:{ show:false } },
            series: [
              { name:'Current', data:s.trend.data },
              s.prevTrend?{ name:'Previous', data:s.prevTrend }:null
            ].filter(Boolean),
            xaxis: { categories:s.trend.labels, labels:{ rotate:-45 } },
            stroke: { curve:'smooth', width:2 },
            tooltip:{ y:v=>`₱${v.toLocaleString()}` }
          }
        );
        salesTrendChart.render();
      } else {
        $('#salesTrendChart').html('<p class="text-center text-muted">No sales data.</p>');
      }

      // ---- Drill-down Table ----
      $('#salesTable tbody').empty();
      (s.transactions||[]).forEach(tx => {
        $('#salesTable tbody').append(`
          <tr>
            <td>${tx.date}</td>
            <td>${tx.id}</td>
            <td>${tx.customer}</td>
            <td>${tx.items}</td>
            <td>₱${tx.amount.toLocaleString()}</td>
          </tr>
        `);
      });

      const $skuTable = $('#topSkuTable tbody').empty();
      (data.descriptive.topSKUs || []).forEach(sku => {
        $skuTable.append(`
          <tr>
            <td class="sku-name">${sku._id}</td>
            <td class="text-right sku-units">${sku.unitsSold} pcs</td>
            <td class="sku-revenue">₱${(sku.revenue || 0).toLocaleString()}</td>
          </tr>
        `);
      });

      // ---- New vs Returning Customers ----
      const newC = data.descriptive?.newCustomers || 0;
      const retC = data.descriptive?.returningCustomers || 0;
      const tot  = newC + retC || 1;
      $('#kpiNewPct').text((newC/tot*100).toFixed(1) + '%');
      // Retention already set above with setChange()

    })
    .fail(() => {
      alert('Failed to load sales data.');
    });
}


// ----- INVENTORY OVERVIEW -----
function loadInventoryOverview(range = 'all') {
  $.getJSON(`/admin/inventory-stats?range=${range}`, data => {
    // 1) KPIs (small cards)
    $('#invTotalSKUs').text(data.totalSKUs);
    $('#invTotalValue').text('₱' + data.totalValue.toLocaleString());
    $('#invCategories').text(data.categoriesCount);
    $('#invLowStockCount').text(data.lowStock.length);
    $('#invExpiringCount').text(data.expiringSoon.length);

    // --- New Smart Analytics (cards below KPIs) ---
    $('#turnoverRate').text(data.turnoverRate || '--');
    $('#daysLeft').text(data.daysLeft || '--');
    $('#topCategory').text(data.topCategory ? `${data.topCategory} (₱${Number(data.topCategoryValue).toLocaleString()})` : '--');
    $('#nextExpiry').text(data.nextExpiry ? new Date(data.nextExpiry).toLocaleDateString() : '--');

    // --- Destroy previous charts to avoid duplicates ---
    if (stockByCategoryChartInstance) {
      stockByCategoryChartInstance.destroy();
      $('#stockByCategoryChart').html('');
    }
    if (valueByCategoryChartInstance) {
      valueByCategoryChartInstance.destroy();
      $('#valueByCategoryChart').html('');
    }

    // 2) Stock by Category (bar)
    stockByCategoryChartInstance = new ApexCharts(document.querySelector('#stockByCategoryChart'), {
      chart: { type: 'bar', height: 250, toolbar: { show: false } },
      series: [{ name: 'Units', data: data.stockByCategory.map(x => x.totalStock) }],
      xaxis: { categories: data.stockByCategory.map(x => x._id), labels: { rotate: -45 } },
      tooltip: { y: { formatter: v => v + ' units' } }
    });
    stockByCategoryChartInstance.render();

    // 3) Value by Category (donut)
    valueByCategoryChartInstance = new ApexCharts(document.querySelector('#valueByCategoryChart'), {
      chart: { type: 'donut', height: 250 },
      series: data.valueByCategory.map(x => x.totalValue),
      labels: data.valueByCategory.map(x => x._id),
      tooltip: { y: { formatter: v => '₱' + Number(v).toLocaleString() } }
    });
    valueByCategoryChartInstance.render();

    // 4) Top 5 Best-Sellers
    $('#topSoldList').empty();
    data.topSold.forEach(p => {
      $('#topSoldList').append(`
        <li class="list-group-item d-flex justify-content-between">
          ${p._id} <span>${p.soldQuantity}</span>
        </li>
      `);
    });

    // 5) Big counts only
    $('#invLowStockCountLarge').text(data.lowStock.length);
    $('#invExpiringCountLarge').text(data.expiringSoon.length);

  }).fail(() => {
    $('#inventoryOverview .card-body')
      .html('<p class="text-danger">Failed to load inventory data.</p>');
  });
}

function loadRevenueByService(range = '7d') {
  const colorPalette = [
    "#008FFB", "#00E396", "#FEB019", "#FF4560", "#775DD0"
  ];
  const rangeMap = {
    today: 'today',
    '7d': '7d',
    month: 'month',
    year: 'year'
  };
  const queryRange = rangeMap[range] || '7d';

  $.getJSON(`/admin/get-dashboard-stats?range=${queryRange}`, data => {
    const svc = data?.descriptive?.revenueByService || [];

    // Destroy previous donut chart instance (avoid stacking)
    if (window.serviceRevenueChartInstance) {
      window.serviceRevenueChartInstance.destroy();
      $('#serviceRevenueChart').html('');
    }

    // Render donut chart only if there is data
    if (svc.length > 0) {
      window.serviceRevenueChartInstance = new ApexCharts(
        document.querySelector('#serviceRevenueChart'),
        {
          series: svc.map(x=>x.total),
          chart: { type:'donut', height:160, width:160, toolbar:{ show:false } },
          labels: svc.map(x=>x._id),
          legend: { show: false },
          tooltip: { y: { formatter: v => `₱${v.toLocaleString()}` } },
          colors: colorPalette
        }
      );
      window.serviceRevenueChartInstance.render();
    }

    // Table below chart (always fill, even if svc is empty)
    const $tbody = $('#serviceRevenueTable tbody').empty();
    if (svc.length === 0) {
      $tbody.append('<tr><td colspan="3" class="text-center text-muted">No data.</td></tr>');
    } else {
      svc.forEach((x, i) => {
        $tbody.append(`
          <tr>
            <td><span class="svc-dot" style="background:${colorPalette[i % colorPalette.length]}"></span></td>
            <td>${x._id || "N/A"}</td>
            <td class="text-right font-weight-bold text-primary">₱${(x.total || 0).toLocaleString()}</td>
          </tr>
        `);
      });
    }
  }).fail(() => {
    $('#serviceRevenueChart').html('');
    $('#serviceRevenueTable tbody').html('<tr><td colspan="3" class="text-center text-muted">No data.</td></tr>');
  });
}


// ==== HELPER STUBS ====
function renderHeatmap(selector, dataMap) {}
function exportCsv(transactions) {}
function exportXlsx(transactions) {}

$(function(){
  // 1) TOTAL APPOINTMENTS
  function loadTotalAppointments() {
    $.getJSON('/admin/get-dashboard-stats', data => {
      const total = (data.appointmentTrends?.completed || []).reduce((a,b)=>a+b,0);
      $('#kpiAppointments').text(total);
      $('#kpiAppChange').text('+0%');
      $('#kpiDoctors').text(data.userStats?.doctors ?? 0);
      $('#kpiDocChange').text('+0%');
      $('#kpiClients').text(data.userStats?.customers ?? 0);
    });
  }

  // 2) PEAK DAY OF WEEK
  function loadPeakDayOfWeek(range = '30d') {
    $.getJSON(`/admin/peak-day-of-week?range=${range}`, resp => {
      if (window.peakDayChartInstance) window.peakDayChartInstance.destroy();
      const ctx = document.getElementById('peakDayChart').getContext('2d');
      window.peakDayChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: resp.days.map(d=>d.dayLabel),
          datasets: [{
            label: 'Appointments',
            data: resp.days.map(d=>d.count),
            borderColor: '#2196f3',
            backgroundColor: '#2196f3',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks:{ autoSkip:false, maxRotation:0 } },
            y: { beginAtZero:true, ticks:{ stepSize:1 } }
          },
          plugins: { legend:{ display:false } }
        }
      });
      $('#peakDayTable tbody').html(
        resp.days.map(d=>
          `<tr><td>${d.dayLabel}</td><td class="text-right">${d.count}</td></tr>`
        ).join('')
      );
    });
  }

  // 3) APPOINTMENT TRENDS CHART
// 3) APPOINTMENT TRENDS CHART
let appointmentTrendChartInstance = null;
function loadAppointmentTrendsChart(range = '7d') {
  $.getJSON(`/admin/get-dashboard-stats?range=${range}`, data => {
    const tr        = data.appointmentTrends || {};
    const labels    = tr.labels    || [];
    const pending   = tr.pending   || [];
    const approved  = tr.approved  || [];
    const completed = tr.completed || [];

    // destroy old chart
    if (appointmentTrendChart) {
      appointmentTrendChart.destroy();
      // clear out the container DIV
      document.querySelector('#appointmentsTrendChart').innerHTML = '';
    }

    // if there’s no data at all, show a placeholder
    if (!labels.length) {
      $('#appointmentsTrendChart').html(
        '<p class="text-center text-muted">No appointments data.</p>'
      );
      return;
    }

    // render with ApexCharts (just like sales)
    appointmentTrendChart = new ApexCharts(
      document.querySelector('#appointmentsTrendChart'),
      {
        chart:  { type: 'line', height: 250, toolbar: { show: false } },
        series: [
          { name: 'Pending',   data: pending },
          { name: 'Approved',  data: approved },
          { name: 'Completed', data: completed }
        ],
        xaxis: { categories: labels, labels: { rotate: -45 } },
        stroke: { curve: 'smooth', width: 2 },
        tooltip: { y: v => `${v}` }
      }
    );
    appointmentTrendChart.render();
  });
}




  // 4) FORECAST (Next 3 Days)
let predictionChartInstance = null;

function loadPredictions() {
  $.getJSON('/admin/predict-appointments', resp => {
    const preds  = resp.predictions || [];
    const labels = preds.map(p => p.date.slice(5));          // e.g. "05-29"
    const data   = preds.map(p => p.predictedCount);

    // ── 1) Destroy old sparkline ─────────────────────────────
    if (predictionChartInstance) {
      predictionChartInstance.destroy();
      document.querySelector('#predictionChart').innerHTML = '';
    }

    // ── 2) Render new sparkline ──────────────────────────────
    predictionChartInstance = new ApexCharts(
      document.querySelector('#predictionChart'),
      {
        chart: {
          type: 'area',
          height: 120,
          sparkline: { enabled: true }
        },
        series: [{ name: 'Forecast', data }],
        stroke: { curve: 'smooth', width: 2 },
        fill: { opacity: 0.3 },
        tooltip: { enabled: true, theme: 'light' }
      }
    );
    predictionChartInstance.render();

    // ── 3) Inject the three values ───────────────────────────
    const $fv = $('#forecastValues').empty();
    preds.forEach((p,i) => {
      // label Day 1 = Tomorrow, Day 2/3 = M-D
      const label = i === 0
        ? 'Tomorrow'
        : new Date(p.date).toLocaleDateString('en-US', { month:'short', day:'numeric' });
      $fv.append(`
        <div class="text-center" style="flex:1">
          <small class="text-muted d-block">${label}</small>
          <strong>${p.predictedCount}</strong>
        </div>
      `);
    });
  });
}

// wire up the filter dropdown
$('#appointmentTrendRange').on('change', () =>
  loadAppointmentTrendsChart($('#appointmentTrendRange').val())
);
  // 5) EVENT BINDINGS
  $('#appointmentTrendRange').on('change', () => 
    loadAppointmentTrendsChart($('#appointmentTrendRange').val())
  );
  $('#peakDayRange').on('change', () =>
    loadPeakDayOfWeek($('#peakDayRange').val())
  );
  $('a[href="#appointmentTrends"]').on('shown.bs.tab', () => {
    loadTotalAppointments();
    loadPeakDayOfWeek($('#peakDayRange').val());
    loadAppointmentTrendsChart($('#appointmentTrendRange').val());
    loadPredictions();
  });

  // 6) INITIAL CALLS
  loadTotalAppointments();
  loadPeakDayOfWeek($('#peakDayRange').val());
  loadAppointmentTrendsChart($('#appointmentTrendRange').val());
  loadPredictions();
});
