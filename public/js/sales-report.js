$(function(){
  const trendCtx = $('#srTrendChart');
  const trendChart = new Chart(trendCtx, {
    type: 'line',
    data: { labels: [], datasets: [{ label:'Revenue', data: [] }] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
  let serviceChart, heatmapChart;

  function fetchAndRender(range, start, end, compare) {
    $.getJSON(`/admin/get-dashboard-stats?range=${range}&start=${start||''}&end=${end||''}&compare=${compare}`, data => {
      const s = data.sales;
      // KPIs
      $('#srTotalRevenue').text(`₱${s.totalRevenue.toLocaleString()}`);
      $('#srTotalTxns').text(s.totalTransactions);
      $('#srAov').text(`₱${(s.totalRevenue/s.totalTransactions||0).toFixed(2)}`);
      $('#srConv').text(`${((s.totalTransactions/s.heatmap.length||0)*100).toFixed(1)}%`);
      $('#srRevChange').text(`${s.comparison?.revenueChangePercent.toFixed(1)||0}%`);
      $('#srTxnChange').text(`${s.comparison?.transactionsChangePercent.toFixed(1)||0}%`);

      // Trend
      trendChart.data.labels = s.trend.labels;
      trendChart.data.datasets[0].data = s.trend.data;
      trendChart.update();

      // Heatmap (ApexCharts)
      const heatmapOpts = {
        chart:{ type:'heatmap', height:150 },
        series:[{ name:'Revenue', data: s.trend.labels.map((d,i)=>({ x:d, y:s.trend.data[i] })) }],
        plotOptions:{ heatmap:{ shadeIntensity:0.5 }},
        dataLabels:{ enabled:false }
      };
      if (heatmapChart) heatmapChart.destroy();
      heatmapChart = new ApexCharts(document.querySelector('#srHeatmap'), heatmapOpts);
      heatmapChart.render();

      // Revenue by Service
      const svc = data.descriptive.revenueByService;
      const labels = svc.map(x=>x._id), vals = svc.map(x=>x.total);
      if (!serviceChart) {
        serviceChart = new Chart($('#srServiceChart'), {
          type: 'doughnut',
          data:{ labels, datasets:[{ data: vals }] },
          options:{ responsive:true, maintainAspectRatio:false }
        });
      } else {
        serviceChart.data.labels = labels;
        serviceChart.data.datasets[0].data = vals;
        serviceChart.update();
      }
      $('#srServiceTable').html(
        svc.map(x=>`<tr><td>${x._id}</td><td class="text-right">₱${x.total.toLocaleString()}</td></tr>`).join('')
      );

      // Top SKUs
      $('#srSkuTable').html(
        data.descriptive.topSKUs.map(x=>
          `<tr><td>${x._id}</td><td class="text-right">${x.unitsSold}</td>
            <td class="text-right">₱${x.revenue.toLocaleString()}</td></tr>`
        ).join('')
      );

      // Transactions
      $('#srTxnTable').html(
        s.transactions.map(t=>
          `<tr>
            <td>${t.date}</td>
            <td>${t.id}</td>
            <td>${t.customer}</td>
            <td>${t.items}</td>
            <td class="text-right">₱${t.amount.toLocaleString()}</td>
          </tr>`
        ).join('')
      );
    });
  }

  // initial load
  fetchAndRender('7d',null,null,'prev');

  // filters
  $('#srPresetRange').on('change', ()=> fetchAndRender($('#srPresetRange').val(),null,null,$('#srCompareMode').val()));
  $('#srCompareMode').on('change', ()=> fetchAndRender($('#srPresetRange').val(),null,null,$('#srCompareMode').val()));
  $('#srCustomRange').daterangepicker({ autoUpdateInput:false })
    .on('apply.daterangepicker',(e,p)=>{
      $(e.target).val(`${p.startDate.format('YYYY-MM-DD')} to ${p.endDate.format('YYYY-MM-DD')}`);
      fetchAndRender('custom',p.startDate.format('YYYY-MM-DD'),p.endDate.format('YYYY-MM-DD'),$('#srCompareMode').val());
    });

  // exports
  $('#exportExcel').on('click',()=> window.location='/admin/generate-report');
  $('#exportCSV').on('click',()=> window.location='/admin/sales-report.csv');
});
