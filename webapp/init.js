sap.ui.define([
    "sap/ui/core/ComponentContainer",
    "sap/ui/model/resource/ResourceModel",
    "sap/m/VBox",
    "sap/m/FlexItemData",
    "sap/f/ShellBar"
], function (ComponentContainer, ResourceModel, VBox, FlexItemData, ShellBar) {
    "use strict";

    /**
     * Arranque de la app cuando se abre directamente (index.html), sin
     * Fiori Launchpad. El Launchpad ya trae su propio header (barra oscura
     * con titulo y boton "atras"); abierta sola la app no tenia ninguno, asi
     * que se replica con un ShellBar: barra oscura, flecha para volver a la
     * pagina anterior y el titulo del reporte.
     */
    var oContainer = new ComponentContainer({
        id: "container",
        name: "yatl01.reportecolumnasdinamicas",
        settings: { id: "yatl01.reportecolumnasdinamicas" },
        manifest: true,
        async: true,
        // El alto lo reparte el VBox: la barra fija arriba y el reporte ocupa el resto
        height: "auto",
        handleValidation: true,
        layoutData: new FlexItemData({ growFactor: 1, minHeight: "0" })
    });

    var oShellBar = new ShellBar({
        title: "{i18n>appTitle}",
        showNavButton: true,
        navButtonPressed: function () {
            window.history.back();
        }
    });

    var oLayout = new VBox({
        height: "100%",
        renderType: "Bare",
        items: [oShellBar, oContainer]
    });
    oLayout.setModel(new ResourceModel({
        bundleName: "yatl01.reportecolumnasdinamicas.i18n.i18n"
    }), "i18n");
    oLayout.placeAt("content");
});
