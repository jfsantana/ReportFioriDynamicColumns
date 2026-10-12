sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"yatl01/reportecolumnasdinamicas/test/integration/pages/TaxReportEnrichedList.gen",
	"yatl01/reportecolumnasdinamicas/test/integration/pages/TaxReportEnrichedObjectPage.gen"
], function (JourneyRunner, TaxReportEnrichedListGenerated, TaxReportEnrichedObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('yatl01/reportecolumnasdinamicas') + '/test/flp.html#app-preview',
        pages: {
			onTheTaxReportEnrichedListGenerated: TaxReportEnrichedListGenerated,
			onTheTaxReportEnrichedObjectPageGenerated: TaxReportEnrichedObjectPageGenerated
        },
        async: true
    });

    return runner;
});

