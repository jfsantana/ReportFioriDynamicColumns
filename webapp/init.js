sap.ui.define([
    "sap/ui/core/ComponentContainer",
    "sap/ui/model/resource/ResourceModel",
    "sap/m/Page"
], function (ComponentContainer, ResourceModel, Page) {
    "use strict";

    /**
     * Arranque de la app cuando se abre directamente (index.html), sin
     * Fiori Launchpad: el Launchpad ya trae su propio header con titulo y
     * boton "atras", pero abierta sola la app no tenia ninguno. Se envuelve
     * el componente en una pagina con el titulo del reporte y la flecha para
     * volver a la pagina anterior.
     */
    var oContainer = new ComponentContainer({
        id: "container",
        name: "yatl01.reportecolumnasdinamicas",
        settings: { id: "yatl01.reportecolumnasdinamicas" },
        manifest: true,
        async: true,
        height: "100%",
        handleValidation: true
    });

    var oPage = new Page({
        title: "{i18n>appTitle}",
        showNavButton: true,
        navButtonPress: function () {
            window.history.back();
        },
        // El List Report (DynamicPage) maneja su propio scroll
        enableScrolling: false,
        content: [oContainer]
    });
    oPage.setModel(new ResourceModel({
        bundleName: "yatl01.reportecolumnasdinamicas.i18n.i18n"
    }), "i18n");
    oPage.placeAt("content");
});
