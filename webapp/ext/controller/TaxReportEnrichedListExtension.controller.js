sap.ui.define([
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/Device",
    "sap/m/OverflowToolbar",
    "sap/m/ToolbarSpacer",
    "sap/m/Button",
    "sap/m/Text",
    "sap/m/Select",
    "sap/m/StepInput",
    "sap/ui/core/Item",
    "sap/m/ToggleButton",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/ui/model/Sorter"
], function (NumberFormat, BusyIndicator, Filter, FilterOperator, MessageToast, MessageBox, Device,
    OverflowToolbar, ToolbarSpacer, Button, Text, Select, StepInput, Item,
    ToggleButton, Table, Column, ColumnListItem, Sorter) {
    "use strict";

    var FIXED_TAX_TYPE = "V";

    // Campos de fecha del reporte y su formato visual (dd.mm.aaaa)
    var DATE_FIELDS = ["DocumentDate", "PostingDate"];
    var DATE_PATTERN = "dd.MM.yyyy";

    // Anchos fijos (solo visualizacion en el navegador). Unidades "rem" simples:
    // NIT ~12 caracteres y Serie ~15 caracteres, mas el relleno de la celda.
    var COLUMN_WIDTHS = {
        nit: "9rem",
        serie: "10.5rem"
    };

    // Anchos para el modo "tabla completa con scroll horizontal" (escritorio y
    // tableta). Cada columna lleva un ancho propio para que, si la suma supera
    // el ancho de la pantalla, aparezca la barra de desplazamiento horizontal
    // en lugar de que las columnas pasen al area emergente (popin).
    var SCROLL_COLUMN_WIDTHS = {
        documentdate: "7rem",
        tipdocsat: "15rem",
        documentreferenceid: "9rem",
        proveedor: "18rem",
        importeiva: "8rem",
        total: "9rem",
        noproveedor: "8.5rem",
        accountingdocument: "9rem"
    };
    // C01..C15 y campos agregados por el usuario. Mas angosto porque los
    // encabezados largos se muestran en varias lineas (ver applyColumnWidths).
    var SCROLL_DEFAULT_WIDTH = "9rem";

    // Paginacion: filas por pagina disponibles (la primera es la predeterminada)
    var PAGE_SIZES = [20, 50, 100];

    // Clase CSS de la tabla (ver css/style.css): encabezados en azul
    var TABLE_STYLE_CLASS = "taxReportTable";

    var oState = {
        oView: null,
        oFilterBar: null,
        oSmartTable: null,
        mParametrosCache: {},    // "sociedad|tipo" -> promesa con filas de TablaParametros
        mParametrosResolved: {}, // "sociedad|tipo" -> filas ya cargadas (consulta sincrona)
        vOriginalNoData: undefined,
        mHiddenByUs: {},         // columnas cN ocultadas por esta extension
        sTaxType: "",            // "V" 
        sCompany: "",            // sociedad del filtro (P_CompanyCode)
        mFilterItems: null,      // campos de filtro C01..C15 (SmartFilterBar)
        bFilterBarHooked: false,
        bSearched: false,        // true despues del primer "Go"
        mParametrosMap: null,    // fieldname(lowercase) -> descripcion
        bTableHooked: false,
        iPage: 0,                // pagina actual (base 0)
        iPageSize: PAGE_SIZES[0],
        bPagerNavigation: false, // true cuando el rebind lo origina el paginador
        oPager: null,            // controles del paginador
        sSummaryMode: "",        // layout totalizado activo: "docType" | "taxCode" | "" (detalle)
        iSummaryToken: 0,        // descarta respuestas antiguas del resumen
        oSummaryTable: null,
        oSummaryButtons: {},     // modo -> ToggleButton de la toolbar
        mHiddenToolbarIds: {},   // botones de la toolbar ocultos en el resumen
        oMovedToolbar: null,     // toolbar de la SmartTable mientras esta en el resumen
        iDetailGrowFactor: undefined,
        oAmountFormatter: null
    };

    /* ============================================================ */
    /* Utilidades generales                                         */
    /* ============================================================ */

    function getResourceBundle() {
        var oModel = oState.oView && oState.oView.getModel ? oState.oView.getModel("i18n") : null;
        return oModel ? oModel.getResourceBundle() : {
            getText: function (sKey) { return sKey; }
        };
    }

    function findParentView(oControl) {
        var oParent = oControl;
        while (oParent && !(oParent.isA && oParent.isA("sap.ui.core.mvc.View"))) {
            oParent = oParent.getParent && oParent.getParent();
        }
        return oParent || null;
    }

    function rememberControls(oController, oFilterBar, oSmartTable) {
        if (!oState.oView && oController && oController.getView) {
            oState.oView = oController.getView();
        }
        if (oFilterBar) {
            oState.oFilterBar = oFilterBar;
        }
        if (oSmartTable) {
            oState.oSmartTable = oSmartTable;
        }
        // Respaldo: si el framework no entrego un "this" con getView()
        if (!oState.oView) {
            oState.oView = findParentView(oSmartTable || oFilterBar);
        }
    }

    function getODataModel() {
        var oControl = oState.oView || oState.oSmartTable || oState.oFilterBar;
        return (oControl && oControl.getModel && oControl.getModel()) || null;
    }

    function findControl(sType) {
        var oView = oState.oView;
        if (!oView) {
            return null;
        }
        var aFound = oView.findAggregatedObjects(true, function (oControl) {
            return oControl.isA && oControl.isA(sType);
        });
        return aFound && aFound.length ? aFound[0] : null;
    }

    function getSmartTable() {
        if (oState.oSmartTable) {
            return oState.oSmartTable;
        }
        oState.oSmartTable = findControl("sap.ui.comp.smarttable.SmartTable");
        return oState.oSmartTable;
    }

    function getFilterBar() {
        if (oState.oFilterBar) {
            return oState.oFilterBar;
        }
        oState.oFilterBar = findControl("sap.ui.comp.smartfilterbar.SmartFilterBar");
        return oState.oFilterBar;
    }

    /**
     * Lee el valor actual de un campo del SmartFilterBar (P_CompanyCode,
     * P_FiscalYear). Los parametros llegan como string; si el
     * campo es un filtro normal puede venir como { items, ranges }.
     */
    function getFilterValue(sFieldName) {
        try {
            var oFilterBar = getFilterBar();
            if (!oFilterBar) {
                return "";
            }
            var mData = oFilterBar.getFilterData() || {};
            var vValue = mData[sFieldName];
            if (vValue === null || vValue === undefined || vValue === "") {
                // Los parametros obligatorios se llaman "$Parameter.<nombre>"
                vValue = mData["$Parameter." + sFieldName];
            }
            if (vValue === null || vValue === undefined) {
                return "";
            }
            if (typeof vValue === "object") {
                if (vValue.items && vValue.items.length) {
                    return String(vValue.items[0].key);
                }
                if (vValue.ranges && vValue.ranges.length) {
                    return String(vValue.ranges[0].value1);
                }
                return "";
            }
            return String(vValue);
        } catch (oError) {
            console.warn("[TaxReport] No se pudo leer el filtro " + sFieldName, oError);
            return "";
        }
    }

    /** El reporte trabaja SIEMPRE con Input Tax (V): no hay filtro de Tipo de Impuesto. */
    function getTaxTypeValue() {
        return FIXED_TAX_TYPE;
    }

    function getAmountFormatter() {
        if (!oState.oAmountFormatter) {
            oState.oAmountFormatter = NumberFormat.getFloatInstance({
                minFractionDigits: 2,
                maxFractionDigits: 2,
                groupingEnabled: true
            });
        }
        return oState.oAmountFormatter;
    }

    /* ============================================================ */
    /* Tipo de impuesto: titulo y encabezados dinamicos             */
    /* ============================================================ */

    /**
     * Lee /TablaParametros filtrando EN EL SERVIDOR por Tipo de Impuesto y
     * Sociedad (solo las filas que aplican al filtro seleccionado). El
     * resultado se cachea por combinacion sociedad|tipo.
     */
    function loadParametros(sCompany, sTaxType) {
        var sKey = (sCompany || "") + "|" + (sTaxType || "");
        if (oState.mParametrosCache[sKey]) {
            return oState.mParametrosCache[sKey];
        }
        var oModel = getODataModel();
        if (!oModel) {
            return Promise.reject(new Error("Modelo OData no disponible"));
        }
        var aFilters = [];
        if (sTaxType) {
            aFilters.push(new Filter("TaxType", FilterOperator.EQ, sTaxType));
        }
        if (sCompany) {
            aFilters.push(new Filter("Sociedad", FilterOperator.EQ, sCompany));
        }
        oState.mParametrosCache[sKey] = new Promise(function (fnResolve, fnReject) {
            oModel.read("/TablaParametros", {
                filters: aFilters,
                success: function (oData) {
                    var aRows = (oData && oData.results) || [];
                    oState.mParametrosResolved[sKey] = aRows;
                    fnResolve(aRows);
                },
                error: fnReject
            });
        }).catch(function (oError) {
            delete oState.mParametrosCache[sKey]; // permite reintentar
            console.error("[TaxReport] Error al leer TablaParametros:", oError);
            throw oError;
        });
        return oState.mParametrosCache[sKey];
    }

    /**
     * Mapa FieldName -> DescripcionGrup solo con las filas del Tipo de
     * Impuesto indicado (no se pueden mezclar V y A). 
     */
    function buildParametrosMap(aRows, sTaxType, sCompany) {
        var mMap = {};
        (aRows || []).forEach(function (oRow) {
            var sRowTax = String(oRow.TaxType || "").trim().toUpperCase();
            if (sTaxType && sRowTax !== sTaxType) {
                return;
            }
            var sRowCompany = String(oRow.Sociedad || "").trim().toUpperCase();
            if (sCompany && sRowCompany !== sCompany) {
                return;
            }
            var sField = String(oRow.FieldName || "").trim().toLowerCase();
            var sDesc = String(oRow.DescripcionGrup || "").trim();
            if (sField && sDesc && !mMap[sField]) {
                mMap[sField] = sDesc;
            }
        });
        return mMap;
    }

    function getReportTitle() {
        var oBundle = getResourceBundle();
        if (oState.sTaxType === "V") {
            return oBundle.getText("titleInputTax");
        }
        if (oState.sTaxType === "A") {
            return oBundle.getText("titleOutputTax");
        }
        return oBundle.getText("titleDefault");
    }

    /** Clave de columna (C01, C02, ...) de una sap.m.Column de la SmartTable. */
    function getColumnKey(oCol) {
        var vData = oCol.data ? oCol.data("p13nData") : null;
        if (typeof vData === "string") {
            try {
                vData = JSON.parse(vData);
            } catch (oError) {
                vData = null;
            }
        }
        var sKey = vData && (vData.columnKey || vData.leadingProperty) || "";
        if (!sKey) {
            var sId = oCol.getId() || "";
            sKey = sId.indexOf("-") !== -1 ? sId.split("-").pop() : sId;
        }
        return String(sKey).trim();
    }

    /**
     * Oculta la columna y la BLOQUEA: cualquier intento posterior de
     * mostrarla (redimensionar una columna, variantes, personalizacion)
     * se ignora mientras no tenga parametro para el filtro actual.
     */
    function lockColumnHidden(oCol) {
        if (!oCol.__taxLocked) {
            var oProto = Object.getPrototypeOf(oCol);
            var fnSetVisible = oProto.setVisible;
            var fnSetProperty = oProto.setProperty;
            oCol.__taxLocked = true;
            oCol.setVisible = function () {
                return fnSetVisible.call(this, false);
            };
            // Tambien se bloquea la escritura directa de la propiedad "visible"
            oCol.setProperty = function (sName, vValue, bSuppressInvalidate) {
                return fnSetProperty.call(this, sName, sName === "visible" ? false : vValue, bSuppressInvalidate);
            };
        }
        oCol.setVisible(false);
    }

    function unlockColumn(oCol) {
        if (oCol.__taxLocked) {
            delete oCol.setVisible;
            delete oCol.setProperty;
            delete oCol.__taxLocked;
        }
    }

    /** No se permite cambiar el ancho de las columnas. */
    function disableColumnResize() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        if (!oInner || !oInner.getDependents) {
            return;
        }
        oInner.getDependents().forEach(function (oDependent) {
            if (oDependent.isA && oDependent.isA("sap.m.plugins.ColumnResizer")
                && oDependent.getEnabled()) {
                oDependent.setEnabled(false);
            }
        });
    }

    /**
     * Excluye las columnas indicadas de la tabla y de la personalizacion
     * (SmartTable.deactivateColumns, API publica desde UI5 1.54). Solo se
     * invoca si la lista cambio, porque esta funcion se ejecuta en cada
     * redibujado de la tabla.
     */
    function syncDeactivatedColumns(oSmartTable, aKeys) {
        if (typeof oSmartTable.deactivateColumns !== "function") {
            return;
        }
        var aCurrent = oSmartTable.getDeactivatedColumns ? oSmartTable.getDeactivatedColumns() : [];
        if (aCurrent.slice().sort().join(",") === aKeys.slice().sort().join(",")) {
            return;
        }
        try {
            oSmartTable.deactivateColumns(aKeys);
        } catch (oError) {
            console.warn("[TaxReport] No se pudieron desactivar las columnas sin mapear", oError);
        }
    }

    /**
     * Ejecuta un paso de ajuste visual aislado: si falla, lo registra en la
     * consola y NO impide que se ejecuten los demas pasos.
     */
    function safeRun(fnStep, sLabel) {
        try {
            fnStep();
        } catch (oError) {
            console.error("[TaxReport] Fallo el paso '" + sLabel + "':", oError);
        }
    }

    /**
     * Aplica los anchos de las columnas y el comportamiento responsivo:
     *  - Escritorio / tableta: se ven TODAS las columnas en horizontal; si no
     *    caben aparece la barra de desplazamiento inferior (sin popin).
     *  - Telefono: se conserva el comportamiento estandar de la tabla
     *    responsiva (las columnas que no caben pasan a formato de tarjeta).
     */
    function applyColumnWidths() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        var aColumns = oInner && oInner.getColumns ? oInner.getColumns() : [];
        var bScroll = !Device.system.phone;
        if (bScroll && oSmartTable) {
            // Sin popin: la SmartTable desactiva el modo automatico de la tabla
            // (autoPopinMode) y muestra todas las columnas. Se quitan tambien
            // los botones "mostrar mas / menos detalles por fila".
            if (oSmartTable.getDemandPopin()) {
                oSmartTable.setDemandPopin(false);
            }
            if (oInner && oInner.getHiddenInPopin && (oInner.getHiddenInPopin() || []).length) {
                oInner.setHiddenInPopin([]);
            }
            var oDetailsButton = sap.ui.getCore().byId(oSmartTable.getId() + "-btnShowHideDetails");
            if (oDetailsButton && oDetailsButton.getVisible()) {
                oDetailsButton.setVisible(false);
            }
        }
        aColumns.forEach(function (oCol) {
            var sKey = getColumnKey(oCol).toLowerCase();
            var sWidth = COLUMN_WIDTHS[sKey]
                || (bScroll ? (SCROLL_COLUMN_WIDTHS[sKey] || SCROLL_DEFAULT_WIDTH) : "");
            if (sWidth && oCol.getWidth() !== sWidth) {
                oCol.setWidth(sWidth);
            }
            // Encabezado en varias lineas en lugar de cortarlo con "..."
            var oHeader = oCol.getHeader && oCol.getHeader();
            if (oHeader && oHeader.setWrapping && !oHeader.getWrapping()) {
                oHeader.setWrapping(true);
            }
            if (bScroll) {
                if (oCol.getDemandPopin()) {
                    oCol.setDemandPopin(false);
                }
            }
        });
    }

    /** Campos numericos fijos con total de pagina (ademas de C01..C99). */
    var TOTAL_FIELDS = ["importeiva", "total"];

    function isNumericColumnKey(sKey) {
        var sLower = String(sKey || "").toLowerCase();
        return /^c\d+$/.test(sLower) || TOTAL_FIELDS.indexOf(sLower) !== -1;
    }

    /** Pone (o actualiza) el texto del pie de una columna; sin texto lo quita. */
    function setColumnFooter(oCol, sText) {
        var oFooter = oCol.getFooter();
        if (!sText) {
            if (oFooter) {
                oCol.destroyFooter();
            }
            return;
        }
        if (oFooter && oFooter.setText) {
            if (oFooter.getText() !== sText) {
                oFooter.setText(sText);
            }
            return;
        }
        oCol.setFooter(new Text({ text: sText, wrapping: false }).addStyleClass("taxReportPageTotal"));
    }

    /**
     * Fila de totales al pie de la tabla: suma de la PAGINA que se esta
     * viendo para cada columna numerica visible (C01..C99 mapeadas, IVA y
     * TOTAL). La etiqueta "TOTAL PAGINA" va en la primera columna visible
     * que no es numerica. Sin filas en la pagina, el pie se quita.
     */
    function updatePageTotals() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        if (!oInner || !oInner.getColumns) {
            return;
        }
        var aRows = (oInner.getItems() || []).map(function (oItem) {
            var oContext = oItem.getBindingContext();
            return oContext ? oContext.getObject() : null;
        }).filter(Boolean);
        var bLabelPlaced = false;

        oInner.getColumns().forEach(function (oCol) {
            var sKey = getColumnKey(oCol);
            if (!aRows.length || !oCol.getVisible()) {
                setColumnFooter(oCol, "");
                return;
            }
            if (isNumericColumnKey(sKey)) {
                var fSum = 0;
                aRows.forEach(function (oRow) {
                    var fValue = parseFloat(oRow[sKey]);
                    if (!isNaN(fValue)) {
                        fSum += fValue;
                    }
                });
                setColumnFooter(oCol, getAmountFormatter().format(Math.round(fSum * 1000) / 1000));
            } else if (!bLabelPlaced) {
                bLabelPlaced = true;
                setColumnFooter(oCol, getResourceBundle().getText("pageTotalLabel"));
            } else {
                setColumnFooter(oCol, "");
            }
        });
    }

    /** Asigna el encabezado dinamico a cada columna cN con descripcion. */
    function applyColumnNames() {
        var oSmartTable = getSmartTable();
        var mMap = oState.mParametrosMap;
        if (!oSmartTable || !mMap) {
            return;
        }
        var oInner = oSmartTable.getTable && oSmartTable.getTable();
        var aColumns = oInner && oInner.getColumns ? oInner.getColumns() : [];

        // Las columnas C01..C99 sin mapeo NO deben verse en ningun lado: se
        // desactivan en la SmartTable (quedan fuera de la tabla y de todos los
        // paneles de "Configuracion": columnas, orden, filtro, grupo).
        // Debe hacerse ANTES de reactivar columnas ya mapeadas.
        var aUnmappedKeys = [];
        aColumns.forEach(function (oCol) {
            var sColKey = getColumnKey(oCol);
            if (/^c\d+$/i.test(sColKey) && !mMap[sColKey.toLowerCase()]) {
                aUnmappedKeys.push(sColKey);
            }
        });
        syncDeactivatedColumns(oSmartTable, aUnmappedKeys);

        aColumns.forEach(function (oCol) {
            var sKey = getColumnKey(oCol).toLowerCase();
            var sDesc = mMap[sKey];

            // Columnas dinamicas (C01..C15): sin fila en TablaParametros para el
            // filtro actual -> no deben aparecer.
            if (/^c\d+$/i.test(sKey)) {
                if (!sDesc) {
                    if (oCol.getVisible()) {
                        oState.mHiddenByUs[sKey] = true;
                    }
                    lockColumnHidden(oCol);
                } else {
                    unlockColumn(oCol);
                    if (oState.mHiddenByUs[sKey]) {
                        oCol.setVisible(true);
                        delete oState.mHiddenByUs[sKey];
                    }
                }
            }
            if (!sDesc) {
                return;
            }
            var oHeader = oCol.getHeader && oCol.getHeader();
            if (oHeader && oHeader.setText && oHeader.getText() !== sDesc) {
                oHeader.setText(sDesc);
            }
            // Mantiene el nombre tambien en el dialogo de personalizacion
            var vData = oCol.data("p13nData");
            if (vData && typeof vData === "object") {
                vData.columnLabel = sDesc;
            }
        });
    }

    /**
     * Titulo dinamico: encabezado de la tabla (SmartTable agrega solo el
     * contador de registros), titulo del shell y de la pestana.
     */
    function applyReportTitle() {
        var sTitle = getReportTitle();
        var oSmartTable = getSmartTable();
        if (oSmartTable && oSmartTable.getHeader() !== sTitle) {
            oSmartTable.setHeader(sTitle);
        }
        try {
            document.title = sTitle;
            if (window.sap && sap.ushell && sap.ushell.Container && sap.ushell.Container.getServiceAsync) {
                sap.ushell.Container.getServiceAsync("ShellUIService").then(function (oService) {
                    oService.setTitle(sTitle);
                });
            }
        } catch (oError) {
            console.warn("[TaxReport] No se pudo actualizar el titulo del shell", oError);
        }
    }

    /**
     * Recalcula el Tipo de Impuesto del filtro, el mapa de encabezados y
     * el titulo. Se llama antes de cada (re)binding de la tabla, con las
     * condiciones del filtro ya confirmadas.
     */
    function refreshForTaxType() {
        oState.sTaxType = getTaxTypeValue().trim().toUpperCase();
        oState.sCompany = getFilterValue("P_CompanyCode").trim().toUpperCase();
        applyReportTitle();
        return loadParametros(oState.sCompany, oState.sTaxType).then(function (aRows) {
            oState.mParametrosMap = buildParametrosMap(aRows, oState.sTaxType, oState.sCompany);
            safeRun(applyColumnNames, "applyColumnNames");
            safeRun(applyColumnWidths, "applyColumnWidths");
            safeRun(applyFilterItems, "applyFilterItems");
        }).catch(function () {
            // El error ya se registro en loadParametros
        });
    }

    /**
     * Asegura que el $select de la consulta incluya TODAS las columnas cN
     * de la tabla: al cambiar de Tipo de Impuesto algunas pueden pasar de
     * ocultas a visibles y deben venir en la misma consulta.
     */
    function ensureSelectForDynamicColumns(mBindingParams) {
        var oParams = mBindingParams && mBindingParams.parameters;
        var oSmartTable = getSmartTable();
        if (!oParams || !oParams.select || !oSmartTable) {
            return;
        }
        var aSelect = String(oParams.select).split(",");
        oSmartTable.getTable().getColumns().forEach(function (oCol) {
            var sKey = getColumnKey(oCol);
            if (/^c\d+$/i.test(sKey) && aSelect.indexOf(sKey) === -1) {
                aSelect.push(sKey);
            }
        });
        oParams.select = aSelect.join(",");
    }

    /**
     * Renombra los campos de filtro C01..C15 con la descripcion de
     * TablaParametros y oculta los que no tienen parametro para el Tipo de
     * Impuesto / Sociedad actuales (tambien en "Adaptar filtros"). Tambien
     * oculta las copias duplicadas de Sociedad y Ejercicio.
     */
    function applyFilterItems() {
        var oFilterBar = getFilterBar();
        if (!oFilterBar) {
            return;
        }
        // Mientras TablaParametros no se haya leido, se asume que ningun campo
        // esta mapeado: las C01..C99 quedan ocultas desde el arranque.
        var bMapLoaded = !!oState.mParametrosMap;
        var mMap = oState.mParametrosMap || {};
        // Un item oculto deja de aparecer en getAllFilterItems: se guardan
        // las referencias para poder volver a mostrarlos. Se revisa en cada
        // llamada porque los items pueden crearse despues del primer intento.
        if (!oState.mFilterItems) {
            oState.mFilterItems = {};
        }
        oFilterBar.getAllFilterItems(false).forEach(function (oItem) {
            var sName = oItem.getName();
            if (/^c\d+$/i.test(sName)) {
                oState.mFilterItems[sName.toLowerCase()] = oItem;
            } else if (sName === "P_CompanyCode" || sName === "P_FiscalYear") {
                oItem.setVisible(false);
            }
        });
        applyFilterDateFormat(oFilterBar);
        Object.keys(oState.mFilterItems).forEach(function (sKey) {
            var oItem = oState.mFilterItems[sKey];
            var sDesc = mMap[sKey];
            if (sDesc) {
                oItem.setLabel(sDesc);
                oItem.setVisible(true);
            } else if (oItem.getVisible()) {
                // Si el usuario habia filtrado por este campo, se limpia el
                // valor para que no filtre en silencio algo que ya no se ve.
                // Solo con el mapeo ya cargado: antes de eso el valor puede
                // venir de una variante y el campo aun se va a mostrar.
                var mData = oFilterBar.getFilterData() || {};
                if (bMapLoaded && mData[oItem.getName()]) {
                    var mClear = {};
                    mClear[oItem.getName()] = null;
                    oFilterBar.setFilterData(mClear);
                }
                oItem.setVisible(false);
            }
        });
    }

    /**
     * Los importes (C01..C15) llevan la unidad CompanyCodeCurrency en el
     * metadata, por lo que la tabla dibuja "valor + moneda" (un HBox con dos
     * textos). Se oculta el texto de la moneda, tanto en las filas ya
     * creadas como en la plantilla (para las que se creen al consultar).
     */
    function hideCurrencyInAmountCells() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        if (!oInner) {
            return;
        }
        var fnHide = function (aCells) {
            (aCells || []).forEach(function (oCell) {
                if (!oCell.isA || !oCell.isA("sap.m.HBox")) {
                    return;
                }
                var aItems = oCell.getItems();
                if (aItems.length < 2) {
                    return;
                }
                var oUnit = aItems[1];
                var oInfo = oUnit.getBindingInfo && oUnit.getBindingInfo("text");
                var bIsCurrency = oInfo && oInfo.parts && oInfo.parts.some(function (oPart) {
                    return oPart.path === "CompanyCodeCurrency";
                });
                if (bIsCurrency && oUnit.getVisible()) {
                    oUnit.setVisible(false);
                }
            });
        };
        var oBindingInfo = oInner.getBindingInfo("items");
        if (oBindingInfo && oBindingInfo.template) {
            fnHide(oBindingInfo.template.getCells());
        }
        (oInner.getItems() || []).forEach(function (oItem) {
            fnHide(oItem.getCells());
        });
    }

    /** Fecha como dd.mm.aaaa (las Edm.DateTime del servicio llegan como Date en UTC). */
    function formatDateDDMMYYYY(oDate) {
        if (!(oDate instanceof Date) || isNaN(oDate.getTime())) {
            return "";
        }
        return ("0" + oDate.getUTCDate()).slice(-2) + "."
            + ("0" + (oDate.getUTCMonth() + 1)).slice(-2) + "."
            + oDate.getUTCFullYear();
    }

    /**
     * Las columnas de fecha (DocumentDate / PostingDate) se muestran siempre
     * como dd.mm.aaaa, sin depender del formato regional del navegador. Se
     * cambia solo el texto de la celda: la columna sigue ligada a la fecha
     * real, por lo que el orden y el filtro no se afectan.
     */
    function formatDateCells() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        if (!oInner) {
            return;
        }
        var fnFormat = function (aCells) {
            (aCells || []).forEach(function (oCell) {
                var oInfo = oCell.getBindingInfo && oCell.getBindingInfo("text");
                var oPart = oInfo && oInfo.parts && oInfo.parts[0];
                if (oPart && DATE_FIELDS.indexOf(oPart.path) > -1 && oInfo.formatter !== formatDateDDMMYYYY) {
                    oCell.bindText({ path: oPart.path, formatter: formatDateDDMMYYYY });
                }
            });
        };
        var oBindingInfo = oInner.getBindingInfo("items");
        if (oBindingInfo && oBindingInfo.template) {
            fnFormat(oBindingInfo.template.getCells());
        }
        (oInner.getItems() || []).forEach(function (oItem) {
            fnFormat(oItem.getCells());
        });
    }

    /** Los filtros de fecha tambien se escriben/muestran como dd.mm.aaaa. */
    function applyFilterDateFormat(oFilterBar) {
        DATE_FIELDS.forEach(function (sName) {
            try {
                var oControl = oFilterBar.determineControlByName && oFilterBar.determineControlByName(sName);
                if (oControl && oControl.setDisplayFormat && oControl.getDisplayFormat() !== DATE_PATTERN) {
                    oControl.setDisplayFormat(DATE_PATTERN);
                }
            } catch (oError) {
                console.warn("[TaxReport] No se pudo dar formato al filtro " + sName, oError);
            }
        });
    }

    function getParametrosKey(sCompany, sTaxType) {
        return (sCompany || "") + "|" + (sTaxType || "");
    }

    /** Hay al menos una columna dinamica (cN) mapeada en el mapa. */
    function hasMappedColumns(mMap) {
        return Object.keys(mMap || {}).some(function (sKey) {
            return /^c\d+$/i.test(sKey);
        });
    }

    /**
     * Combinacion sin columnas configuradas: deja la tabla vacia (sin
     * documentos) con un mensaje explicativo.
     */
    function showNoColumnsState(oSmartTable) {
        var oInner = oSmartTable.getTable();
        if (oState.vOriginalNoData === undefined) {
            oState.vOriginalNoData = oSmartTable.getNoData();
        }
        try {
            oSmartTable.setNoData(getResourceBundle().getText("noColumnsConfigured"));
        } catch (oError) {
            console.warn("[TaxReport] No se pudo asignar el mensaje de tabla vacia", oError);
        }
        if (oInner.getBinding("items")) {
            oInner.unbindItems();
        }
        oInner.removeAllItems();
    }

    function restoreNoDataText(oSmartTable) {
        if (oState.vOriginalNoData !== undefined) {
            try {
                oSmartTable.setNoData(oState.vOriginalNoData);
            } catch (oError) {
                console.warn("[TaxReport] No se pudo restaurar el mensaje de tabla vacia", oError);
            }
            oState.vOriginalNoData = undefined;
        }
    }

    /**
     * Antes de consultar la tabla se verifica que la combinacion de filtros
     * tenga columnas configuradas. Devuelve true si la consulta se detuvo
     * (preventTableBind) y no debe continuar.
     */
    function guardRebind(oSmartTable, mBindingParams) {
        oState.sTaxType = getTaxTypeValue().trim().toUpperCase();
        oState.sCompany = getFilterValue("P_CompanyCode").trim().toUpperCase();
        var sKey = getParametrosKey(oState.sCompany, oState.sTaxType);
        var aRows = oState.mParametrosResolved[sKey];

        if (!aRows) {
            // Aun no se conoce el mapeo de esta combinacion: se detiene la
            // consulta, se carga TablaParametros y se reintenta.
            if (mBindingParams) {
                mBindingParams.preventTableBind = true;
            }
            loadParametros(oState.sCompany, oState.sTaxType).then(function () {
                oSmartTable.rebindTable();
            }).catch(function () { /* ya registrado */ });
            return true;
        }

        if (!hasMappedColumns(buildParametrosMap(aRows, oState.sTaxType, oState.sCompany))) {
            if (mBindingParams) {
                mBindingParams.preventTableBind = true;
            }
            showNoColumnsState(oSmartTable);
            refreshForTaxType();
            return true;
        }

        restoreNoDataText(oSmartTable);
        return false;
    }

    /**
     * Apenas el usuario cambia un filtro, los resultados se ocultan: para
     * volver a verlos hay que pulsar "Go".
     */
    function hideResultsOnFilterChange() {
        if (!oState.bSearched) {
            return;
        }
        var oSmartTable = getSmartTable();
        if (oSmartTable && oSmartTable.getVisible()) {
            oSmartTable.setVisible(false);
        }
    }

    /** La tabla no se muestra hasta que el usuario pulsa "Go". */
    function hideTableUntilSearch(iRetries) {
        if (oState.bSearched) {
            return;
        }
        var oSmartTable = getSmartTable();
        if (oSmartTable) {
            oSmartTable.setVisible(false);
        } else if ((iRetries || 0) < 20) {
            setTimeout(function () {
                hideTableUntilSearch((iRetries || 0) + 1);
            }, 200);
        }
    }

    function showTable() {
        oState.bSearched = true;
        var oSmartTable = getSmartTable();
        if (oSmartTable && !oSmartTable.getVisible()) {
            oSmartTable.setVisible(true);
        }
    }

    /**
     * Engancha la barra de filtros: "Go" muestra la tabla y cualquier cambio
     * de filtro (sociedad, ejercicio) recalcula nombres de filtros/columnas.
     */
    function hookFilterBar() {
        var oFilterBar = getFilterBar();
        if (!oFilterBar || oState.bFilterBarHooked) {
            return;
        }
        oState.bFilterBarHooked = true;
        oFilterBar.attachSearch(showTable);
        // Oculta de inmediato los campos C01..C99 (aun sin mapeo cargado) y
        // reaplica al terminar la inicializacion / al cargar una variante.
        applyFilterItems();
        ["attachInitialized", "attachAfterVariantLoad"].forEach(function (sAttach) {
            try {
                oFilterBar[sAttach](applyFilterItems);
            } catch (oError) {
                console.warn("[TaxReport] SmartFilterBar sin " + sAttach, oError);
            }
        });
        oFilterBar.attachFilterChange(function () {
            hideResultsOnFilterChange();
            refreshForTaxType();
        });
    }

    /** Reaplica encabezados cuando la tabla se redibuja o llegan datos. */
    function hookSmartTable(oSmartTable) {
        if (!oSmartTable || oState.bTableHooked) {
            return;
        }
        oState.bTableHooked = true;
        oSmartTable.addStyleClass(TABLE_STYLE_CLASS);
        disableColumnResize();
        safeRun(function () { setupPaging(oSmartTable); }, "setupPaging");
        safeRun(function () { setupSummary(oSmartTable); }, "setupSummary");
        var fnReapply = function () {
            safeRun(applyReportTitle, "applyReportTitle");
            safeRun(applyColumnNames, "applyColumnNames");
            safeRun(applyColumnWidths, "applyColumnWidths");
            safeRun(hideCurrencyInAmountCells, "hideCurrencyInAmountCells");
            safeRun(formatDateCells, "formatDateCells");
            safeRun(disableColumnResize, "disableColumnResize");
            safeRun(updatePageTotals, "updatePageTotals");
            safeRun(updatePager, "updatePager");
        };
        try {
            oSmartTable.attachDataReceived(fnReapply);
        } catch (oError) {
            console.warn("[TaxReport] SmartTable sin evento dataReceived", oError);
        }
        try {
            oSmartTable.getTable().attachUpdateFinished(fnReapply);
        } catch (oError) {
            console.warn("[TaxReport] Tabla interna sin evento updateFinished", oError);
        }
        // Variantes a nivel de tabla (smartVariantManagement = false): al
        // aplicar una variante se vuelven a ocultar las columnas C01..C15 sin
        // parametro y se reaplican titulo, anchos y formatos.
        try {
            oSmartTable.attachAfterVariantApply(fnReapply);
        } catch (oError) {
            console.warn("[TaxReport] SmartTable sin evento afterVariantApply", oError);
        }
    }

    /* ============================================================ */
    /* Paginacion (controles estandar sap.m)                        */
    /* ============================================================ */

    /**
     * El paginador consulta al servidor solo la pagina actual ($skip/$top),
     * por eso el "growing" (boton "Mas") de la tabla se desactiva: ese
     * mecanismo siempre pide desde la fila 0.
     */
    function disableGrowing(oSmartTable) {
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        if (oInner && oInner.getGrowing && oInner.getGrowing()) {
            oInner.setGrowing(false);
        }
    }

    /**
     * Respaldo del orden inicial (el principal es UI.PresentationVariant en
     * annotation.xml): si la consulta no trae ningun orden, se ordena
     * ascendente por DIA (DocumentDate) y por documento para desempatar.
     * Si el usuario eligio otro orden, no se toca.
     */
    function applyDefaultSort(mBindingParams) {
        if (!mBindingParams || (mBindingParams.sorter && mBindingParams.sorter.length)) {
            return;
        }
        mBindingParams.sorter = [
            new Sorter("DocumentDate", false),
            new Sorter("AccountingDocument", false)
        ];
    }

    /**
     * Fija la pagina solicitada en los parametros del binding. Cualquier
     * consulta que NO venga del paginador (Go, orden, filtros, variante)
     * vuelve a la primera pagina.
     */
    function applyPaging(oSmartTable, mBindingParams) {
        if (!mBindingParams) {
            return;
        }
        disableGrowing(oSmartTable);
        if (!oState.bPagerNavigation) {
            oState.iPage = 0;
        }
        oState.bPagerNavigation = false;
        mBindingParams.startIndex = oState.iPage * oState.iPageSize;
        mBindingParams.length = oState.iPageSize;
    }

    function goToPage(iPage, iPageSize) {
        var oSmartTable = getSmartTable();
        if (!oSmartTable) {
            return;
        }
        if (iPageSize) {
            oState.iPageSize = iPageSize;
        }
        oState.iPage = Math.max(0, iPage);
        oState.bPagerNavigation = true;
        oSmartTable.rebindTable(true);
    }

    /** Crea la barra de paginacion y la agrega debajo de la tabla. */
    function createPager(oSmartTable) {
        var oBundle = getResourceBundle();
        var oPager = { iPages: 1 };

        oPager.oFirst = new Button({
            icon: "sap-icon://media-rewind",
            tooltip: oBundle.getText("pagerFirst"),
            type: "Transparent",
            press: function () { goToPage(0); }
        });
        oPager.oPrev = new Button({
            icon: "sap-icon://navigation-left-arrow",
            tooltip: oBundle.getText("pagerPrevious"),
            type: "Transparent",
            press: function () { goToPage(oState.iPage - 1); }
        });
        oPager.oNext = new Button({
            icon: "sap-icon://navigation-right-arrow",
            tooltip: oBundle.getText("pagerNext"),
            type: "Transparent",
            press: function () { goToPage(oState.iPage + 1); }
        });
        oPager.oLast = new Button({
            icon: "sap-icon://media-forward",
            tooltip: oBundle.getText("pagerLast"),
            type: "Transparent",
            press: function () { goToPage(oPager.iPages - 1); }
        });
        oPager.oPageInput = new StepInput({
            min: 1,
            max: 1,
            value: 1,
            step: 1,
            width: "7rem",
            change: function (oEvent) {
                var iValue = parseInt(oEvent.getParameter("value"), 10);
                if (iValue >= 1 && iValue <= oPager.iPages && iValue - 1 !== oState.iPage) {
                    goToPage(iValue - 1);
                } else {
                    updatePager();
                }
            }
        });
        oPager.oPageText = new Text({ text: oBundle.getText("pagerPage") });
        oPager.oOfText = new Text({ text: "" });
        oPager.oRange = new Text({ text: "" });
        oPager.oSizeSelect = new Select({
            width: "5.5rem",
            selectedKey: String(oState.iPageSize),
            items: PAGE_SIZES.map(function (iSize) {
                return new Item({ key: String(iSize), text: String(iSize) });
            }),
            change: function (oEvent) {
                goToPage(0, parseInt(oEvent.getParameter("selectedItem").getKey(), 10));
            }
        });

        oPager.oToolbar = new OverflowToolbar({
            visible: false,
            content: [
                new Text({ text: oBundle.getText("pagerRowsPerPage") }),
                oPager.oSizeSelect,
                new ToolbarSpacer(),
                oPager.oRange,
                oPager.oFirst,
                oPager.oPrev,
                oPager.oPageText,
                oPager.oPageInput,
                oPager.oOfText,
                oPager.oNext,
                oPager.oLast
            ]
        });
        oPager.oToolbar.addStyleClass("taxReportPager");
        oSmartTable.addItem(oPager.oToolbar);
        oState.oPager = oPager;
    }

    /** Actualiza la barra con el total de filas del binding. */
    function updatePager() {
        var oPager = oState.oPager;
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        var oBinding = oInner && oInner.getBinding && oInner.getBinding("items");
        if (!oPager || !oBinding || !oBinding.getLength) {
            return;
        }
        if (oBinding.isLengthFinal && !oBinding.isLengthFinal()) {
            return;
        }
        var oBundle = getResourceBundle();
        var iTotal = oBinding.getLength() || 0;
        var iSize = oState.iPageSize;
        var iPages = Math.max(1, Math.ceil(iTotal / iSize));

        // Pagina inexistente (por ejemplo, ahora hay menos filas): ultima pagina
        if (iTotal > 0 && oState.iPage >= iPages) {
            goToPage(iPages - 1);
            return;
        }

        var iFirst = iTotal ? oState.iPage * iSize + 1 : 0;
        var iLast = Math.min(iTotal, (oState.iPage + 1) * iSize);
        oPager.iPages = iPages;
        oPager.oPageInput.setMax(iPages);
        oPager.oPageInput.setValue(oState.iPage + 1);
        oPager.oOfText.setText(oBundle.getText("pagerOf", [iPages]));
        oPager.oRange.setText(oBundle.getText("pagerRange", [iFirst, iLast, iTotal]));
        oPager.oSizeSelect.setSelectedKey(String(iSize));
        oPager.oFirst.setEnabled(oState.iPage > 0);
        oPager.oPrev.setEnabled(oState.iPage > 0);
        oPager.oNext.setEnabled(oState.iPage < iPages - 1);
        oPager.oLast.setEnabled(oState.iPage < iPages - 1);
        oPager.oToolbar.setVisible(iTotal > 0);
    }

    function setupPaging(oSmartTable) {
        disableGrowing(oSmartTable);
        if (!oState.oPager) {
            createPager(oSmartTable);
        }
    }

    /* ============================================================ */
    /* Layouts totalizados: por Tipo de Documento / por Tipo de     */
    /* Impuesto (TaxCode)                                           */
    /* ============================================================ */

    // Botones de la toolbar de la SmartTable que solo aplican al detalle
    var SUMMARY_HIDDEN_BUTTONS = ["-btnPersonalisation", "-btnExcelExport"];

    function trimValue(vValue) {
        return String(vValue === null || vValue === undefined ? "" : vValue).trim();
    }

    /** "FACTURA (FACT)": descripcion + codigo SAT, igual que la vista de detalle. */
    function formatTypeLabel(sCode, sDescription) {
        if (sDescription && sCode) {
            return sDescription + " (" + sCode + ")";
        }
        return sDescription || sCode || getResourceBundle().getText("summaryNoType");
    }

    /**
     * Layouts totalizados disponibles. Cada uno define:
     *  - select: campos OData que se agrupan
     *  - labelColumns: columnas de texto del resumen (encabezado i18n y ancho)
     *  - group(oRow): { id, sort, labels } -> clave del grupo, orden y textos
     * Todas las columnas numericas (C01..C99 mapeadas, IVA y TOTAL) se suman.
     */
    var SUMMARY_MODES = {
        docType: {
            buttonKey: "summaryButton",
            tooltipKey: "summaryTooltip",
            select: ["TipDocSat", "DescTipoDocumento"],
            labelColumns: [{ headerKey: "summaryType", width: "18rem" }],
            group: function (oRow) {
                var sCode = trimValue(oRow.TipDocSat);
                return {
                    id: sCode,
                    sort: sCode,
                    labels: [formatTypeLabel(sCode, trimValue(oRow.DescTipoDocumento))]
                };
            }
        },
        taxCode: {
            buttonKey: "summaryTaxButton",
            tooltipKey: "summaryTaxTooltip",
            select: ["TaxCode", "TaxCodeName"],
            labelColumns: [
                { headerKey: "summaryTaxCode", width: "8rem" },
                { headerKey: "summaryTaxCodeName", width: "18rem" }
            ],
            group: function (oRow) {
                var sCode = trimValue(oRow.TaxCode);
                var sName = trimValue(oRow.TaxCodeName);
                return {
                    id: sCode + "|" + sName,
                    sort: sCode,
                    labels: [sCode || getResourceBundle().getText("summaryNoTaxCode"), sName]
                };
            }
        }
    };

    /** Columnas numericas del resumen: C01..C99 mapeadas, IVA y TOTAL. */
    function getSummaryAmountColumns() {
        var aColumns = getMappedDynamicKeys().map(function (sKey) {
            return { header: oState.mParametrosMap[sKey], key: sKey.toUpperCase() };
        });
        aColumns.push({ header: "IVA", key: "ImporteIVA" }, { header: "TOTAL", key: "Total" });
        return aColumns;
    }

    /**
     * Agrupa las filas segun el layout y suma todas las columnas numericas.
     * Dentro de un grupo los documentos se cuentan SIN repetir; el total de
     * DOCUMENTOS es la suma de los grupos (ver renderSummary).
     */
    function groupRows(aRows, oMode, aAmountColumns) {
        var mGroups = {};
        var aGroups = [];
        var oGrand = { docs: {}, sums: {} };
        aAmountColumns.forEach(function (oCol) { oGrand.sums[oCol.key] = 0; });

        aRows.forEach(function (oRow) {
            var oInfo = oMode.group(oRow);
            var oGroup = mGroups[oInfo.id];
            if (!oGroup) {
                oGroup = { id: oInfo.id, sort: oInfo.sort, labels: oInfo.labels, docs: {}, sums: {} };
                aAmountColumns.forEach(function (oCol) { oGroup.sums[oCol.key] = 0; });
                mGroups[oInfo.id] = oGroup;
                aGroups.push(oGroup);
            }
            var sDocKey = [oRow.CompanyCode, oRow.AccountingDocument, oRow.FiscalYear].join("|");
            oGroup.docs[sDocKey] = true;
            oGrand.docs[sDocKey] = true;
            aAmountColumns.forEach(function (oCol) {
                var fValue = parseFloat(oRow[oCol.key]);
                if (!isNaN(fValue)) {
                    oGroup.sums[oCol.key] += fValue;
                    oGrand.sums[oCol.key] += fValue;
                }
            });
        });
        aGroups.sort(function (a, b) {
            if (a.sort !== b.sort) {
                return a.sort < b.sort ? -1 : 1;
            }
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
        });
        return { groups: aGroups, grand: oGrand };
    }

    function createSummaryColumn(sHeader, bEnd, sWidth) {
        return new Column({
            header: new Text({ text: sHeader }),
            hAlign: bEnd ? "End" : "Begin",
            width: sWidth
        });
    }

    function createSummaryItem(aTexts, sStyleClass) {
        var oItem = new ColumnListItem({
            cells: aTexts.map(function (sText) { return new Text({ text: sText }); })
        });
        if (sStyleClass) {
            oItem.addStyleClass(sStyleClass);
        }
        return oItem;
    }

    /** Dibuja la tabla resumen: una fila por grupo y una fila final de TOTAL GENERAL. */
    function renderSummary(aRows, oMode) {
        var oTable = oState.oSummaryTable;
        var oBundle = getResourceBundle();
        var aAmountColumns = getSummaryAmountColumns();
        var oResult = groupRows(aRows, oMode, aAmountColumns);

        oTable.destroyItems();
        oTable.destroyColumns();
        oMode.labelColumns.forEach(function (oLabelCol) {
            oTable.addColumn(createSummaryColumn(oBundle.getText(oLabelCol.headerKey), false, oLabelCol.width));
        });
        oTable.addColumn(createSummaryColumn(oBundle.getText("summaryDocuments"), true, "8rem"));
        aAmountColumns.forEach(function (oCol) {
            oTable.addColumn(createSummaryColumn(oCol.header, true, "11rem"));
        });

        var fnAmounts = function (oSums) {
            return aAmountColumns.map(function (oCol) { return formatCellValue(oSums[oCol.key], true); });
        };
        oResult.groups.forEach(function (oGroup) {
            oTable.addItem(createSummaryItem(oGroup.labels
                .concat([String(Object.keys(oGroup.docs).length)], fnAmounts(oGroup.sums))));
        });
        if (oResult.groups.length) {
            // "TOTAL GENERAL" va en la primera columna de texto; las demas quedan vacias
            var aTotalLabels = oMode.labelColumns.map(function (oLabelCol, iIndex) {
                return iIndex === 0 ? oBundle.getText("summaryGrandTotal") : "";
            });
            // DOCUMENTOS del total = suma de la columna (consistente con las filas)
            var iTotalDocs = oResult.groups.reduce(function (iSum, oGroup) {
                return iSum + Object.keys(oGroup.docs).length;
            }, 0);
            oTable.addItem(createSummaryItem(aTotalLabels
                .concat([String(iTotalDocs)], fnAmounts(oResult.grand.sums)),
            "taxReportSummaryTotal"));
        }
    }

    /** Consulta todas las filas del filtro actual y recalcula el resumen activo. */
    function refreshSummary() {
        var oSmartTable = getSmartTable();
        var oTable = oState.oSummaryTable;
        var oMode = SUMMARY_MODES[oState.sSummaryMode];
        if (!oMode || !oSmartTable || !oTable) {
            return;
        }
        var iToken = ++oState.iSummaryToken;
        var aSelect = ["ImporteIVA", "Total", "CompanyCode", "AccountingDocument", "FiscalYear"]
            .concat(oMode.select, getMappedDynamicKeys().map(function (sKey) { return sKey.toUpperCase(); }));

        oTable.setBusy(true);
        requestAllRows(oSmartTable, aSelect).then(function (aRows) {
            if (iToken === oState.iSummaryToken) {
                renderSummary(aRows, oMode);
            }
        }).catch(function (oError) {
            console.error("[TaxReport] Error al calcular el resumen '" + oState.sSummaryMode + "':", oError);
            if (iToken === oState.iSummaryToken) {
                oTable.destroyItems();
                MessageToast.show(getResourceBundle().getText("summaryError"));
            }
        }).finally(function () {
            if (iToken === oState.iSummaryToken) {
                oTable.setBusy(false);
            }
        });
    }

    /** Oculta/restaura los botones de la toolbar que solo aplican al detalle. */
    function toggleDetailOnlyButtons(bHide) {
        var oSmartTable = getSmartTable();
        if (!oSmartTable) {
            return;
        }
        SUMMARY_HIDDEN_BUTTONS.forEach(function (sSuffix) {
            var sButtonId = oSmartTable.getId() + sSuffix;
            var oButton = sap.ui.getCore().byId(sButtonId);
            if (!oButton) {
                return;
            }
            if (bHide && oButton.getVisible()) {
                oState.mHiddenToolbarIds[sButtonId] = true;
                oButton.setVisible(false);
            } else if (!bHide && oState.mHiddenToolbarIds[sButtonId]) {
                delete oState.mHiddenToolbarIds[sButtonId];
                oButton.setVisible(true);
            }
        });
    }

    /**
     * La barra de herramientas (titulo, botones de totales, Exportar PDF, etc.)
     * vive DENTRO de la tabla de detalle, asi que al ocultarla desaparecia.
     * En el resumen se pasa a la tabla resumen y al volver se devuelve.
     * Ademas, la tabla de detalle tiene "growFactor = 1" en el contenedor
     * flex de la SmartTable: aunque este oculta, su contenedor seguia
     * ocupando el espacio libre y empujaba el resumen hacia abajo.
     */
    function moveToolbarAndLayout(bSummary) {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable();
        if (!oInner || !oState.oSummaryTable) {
            return;
        }
        var oLayoutData = oInner.getLayoutData && oInner.getLayoutData();
        if (bSummary) {
            var oToolbar = oInner.getHeaderToolbar && oInner.getHeaderToolbar();
            if (oToolbar) {
                oState.oMovedToolbar = oToolbar;
                oState.oSummaryTable.setHeaderToolbar(oToolbar);
            }
            if (oLayoutData && oLayoutData.setGrowFactor) {
                oState.iDetailGrowFactor = oLayoutData.getGrowFactor();
                oLayoutData.setGrowFactor(0);
            }
        } else {
            if (oState.oMovedToolbar) {
                oInner.setHeaderToolbar(oState.oMovedToolbar);
                oState.oMovedToolbar = null;
            }
            if (oLayoutData && oLayoutData.setGrowFactor && oState.iDetailGrowFactor !== undefined) {
                oLayoutData.setGrowFactor(oState.iDetailGrowFactor);
            }
        }
    }

    /** Solo el boton del layout activo queda "presionado". */
    function syncSummaryButtons() {
        Object.keys(oState.oSummaryButtons).forEach(function (sMode) {
            oState.oSummaryButtons[sMode].setPressed(sMode === oState.sSummaryMode);
        });
    }

    /**
     * Activa un layout totalizado ("docType" | "taxCode") o vuelve al
     * detalle (cadena vacia). Cambiar de un resumen a otro no pasa por el detalle.
     */
    function setSummaryMode(sMode) {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable();
        if (!oSmartTable || !oState.oSummaryTable) {
            return;
        }
        if (sMode && !(oInner.getBindingInfo("items") || oInner.getBindingInfo("rows"))) {
            MessageToast.show(getResourceBundle().getText("pdfNoData"));
            oState.sSummaryMode = "";
            syncSummaryButtons();
            return;
        }
        var bWasOn = !!oState.sSummaryMode;
        var bOn = !!sMode;
        var bSwitching = bWasOn && bOn && oState.sSummaryMode !== sMode;

        oState.sSummaryMode = sMode;
        syncSummaryButtons();
        if (bOn && oState.oSummaryInfoText) {
            var oBundle = getResourceBundle();
            oState.oSummaryInfoText.setText(oBundle.getText("summaryInfo",
                [oBundle.getText(SUMMARY_MODES[sMode].buttonKey)]));
        }
        oSmartTable.toggleStyleClass("taxReportSummaryMode", bOn);
        oState.oSummaryTable.setVisible(bOn);
        if (bOn !== bWasOn) {
            toggleDetailOnlyButtons(bOn);
            moveToolbarAndLayout(bOn);
        }
        if (bSwitching) {
            // no mostrar un instante las columnas del resumen anterior
            oState.oSummaryTable.destroyItems();
            oState.oSummaryTable.destroyColumns();
        }
        if (bOn) {
            refreshSummary();
        } else {
            oState.iSummaryToken += 1;
        }
    }

    /**
     * Crea la tabla resumen (oculta) debajo de la tabla de detalle y los
     * botones "Total por Tipo de Documento" y "Total por Tipo de Impuesto",
     * a la izquierda de "Exportar PDF".
     */
    function setupSummary(oSmartTable) {
        if (oState.oSummaryTable) {
            return;
        }
        var oBundle = getResourceBundle();
        var oInner = oSmartTable.getTable();
        oInner.addStyleClass("taxReportDetail");

        oState.oSummaryTable = new Table({
            visible: false,
            noDataText: oBundle.getText("summaryNoData")
        });
        oState.oSummaryTable.addStyleClass("taxReportSummaryTable");

        // Barra informativa del resumen: indica que vista de totales esta
        // activa y ofrece un boton visible para regresar al detalle.
        oState.oSummaryInfoText = new Text({ wrapping: false });
        oState.oSummaryTable.setInfoToolbar(new OverflowToolbar({
            design: "Info",
            content: [
                oState.oSummaryInfoText,
                new ToolbarSpacer(),
                new Button({
                    text: oBundle.getText("summaryBackButton"),
                    icon: "sap-icon://nav-back",
                    type: "Emphasized",
                    press: function () { setSummaryMode(""); }
                })
            ]
        }));
        oSmartTable.addItem(oState.oSummaryTable);

        var oToolbar = oSmartTable.getCustomToolbar && oSmartTable.getCustomToolbar();
        var iInsertIndex = 0;
        if (oToolbar) {
            var aContent = oToolbar.getContent();
            var iPdfIndex = -1;
            aContent.forEach(function (oControl, iIndex) {
                if (iPdfIndex === -1 && oControl.getId().indexOf("exportPdfBackendButton") !== -1) {
                    iPdfIndex = iIndex;
                }
            });
            iInsertIndex = iPdfIndex === -1 ? aContent.length : iPdfIndex;
        } else {
            console.warn("[TaxReport] La tabla no tiene toolbar personalizada: no se agregaron los botones de totales");
        }

        Object.keys(SUMMARY_MODES).forEach(function (sMode) {
            var oMode = SUMMARY_MODES[sMode];
            var oButton = new ToggleButton({
                icon: "sap-icon://table-view",
                text: oBundle.getText(oMode.buttonKey),
                tooltip: oBundle.getText(oMode.tooltipKey),
                type: "Transparent",
                press: function (oEvent) { setSummaryMode(oEvent.getParameter("pressed") ? sMode : ""); }
            });
            oState.oSummaryButtons[sMode] = oButton;
            if (oToolbar) {
                oToolbar.insertContent(oButton, iInsertIndex);
                iInsertIndex += 1;   // los botones quedan en el orden de SUMMARY_MODES
            }
        });

        // Si el usuario vuelve a ejecutar la busqueda con un resumen activo, se recalcula
        oSmartTable.attachDataRequested(function () {
            if (oState.sSummaryMode) {
                oState.oSummaryTable.setBusy(true);
            }
        });
        oSmartTable.attachDataReceived(function () {
            safeRun(refreshSummary, "refreshSummary");
        });
    }

    /** Formato de celda: importes con miles y 2 decimales (sin moneda: va en su columna). */
    function formatCellValue(vValue, bIsAmount) {
        if (vValue === null || vValue === undefined || vValue === "") {
            return "";
        }
        if (bIsAmount) {
            var fNumber = parseFloat(vValue);
            if (!isNaN(fNumber)) {
                return getAmountFormatter().format(fNumber);
            }
        }
        return String(vValue);
    }

    /** Columnas C01..C99 mapeadas para el filtro actual, en orden numerico. */
    function getMappedDynamicKeys() {
        return Object.keys(oState.mParametrosMap || {})
            .filter(function (sKey) { return /^c\d+$/i.test(sKey); })
            .sort(function (a, b) { return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10); });
    }

    /**
     * Pide TODAS las filas que coinciden con los filtros actuales
     * (no solo las que muestra la tabla con paginacion), reutilizando la
     * ruta, filtros y orden del binding de la tabla. El $select se arma con
     * los campos del PDF (no con las columnas visibles de la tabla).
     */
    function requestAllRows(oSmartTable, aSelect) {
        var oInner = oSmartTable.getTable();
        var oInfo = oInner.getBindingInfo("items") || oInner.getBindingInfo("rows");
        var oModel = oSmartTable.getModel();
        if (!oInfo || !oModel) {
            return Promise.reject(new Error("El binding de la tabla no esta disponible"));
        }
        var aSorters = oInfo.sorter ? [].concat(oInfo.sorter) : [];
        var aFilters = oInfo.filters ? [].concat(oInfo.filters) : [];
        var mUrlParameters = {};
        if (aSelect && aSelect.length) {
            mUrlParameters.$select = aSelect.join(",");
        }
        return new Promise(function (fnResolve, fnReject) {
            oModel.read(oInfo.path, {
                filters: aFilters,
                sorters: aSorters,
                urlParameters: mUrlParameters,
                success: function (oData) {
                    fnResolve((oData && oData.results) || []);
                },
                error: fnReject
            });
        });
    }

    /* ============================================================ */
    /* PDF generado en backend (piloto): accion RAP generarPdf      */
    /* del servicio OData V4 + descarga de PdfStream(<Guid>)/PdfData */
    /* ============================================================ */

    var PDF_V4_SERVICE = "/sap/opu/odata4/sap/ymqaf_sb_taxrpt_enriched/srvd/sap/ymqaf_sd_taxrpt_enriched/0001/";

    /**
     * Lee el $metadata del servicio V4 y, en la misma llamada, pide el
     * token CSRF. Devuelve { token, namespace }. El namespace se necesita
     * para el nombre completo de la accion (namespace.generarPdf).
     */
    function fetchV4TokenAndNamespace() {
        return fetch(PDF_V4_SERVICE + "$metadata", {
            method: "GET",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": "Fetch" }
        }).then(function (oResponse) {
            if (!oResponse.ok) {
                throw new Error("$metadata HTTP " + oResponse.status);
            }
            var sToken = oResponse.headers.get("X-CSRF-Token");
            return oResponse.text().then(function (sXml) {
                var aMatch = /<Schema[^>]*\sNamespace="([^"]+)"/.exec(sXml);
                if (!aMatch) {
                    throw new Error("Namespace no encontrado en $metadata");
                }
                return { token: sToken, namespace: aMatch[1] };
            });
        });
    }

    /** Llama a la accion estatica generarPdf y devuelve el registro creado. */
    function callGenerarPdf(oCtx, mParams) {
        return fetch(PDF_V4_SERVICE + "PdfStream/" + oCtx.namespace + ".generarPdf", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "X-CSRF-Token": oCtx.token,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(mParams)
        }).then(function (oResponse) {
            return oResponse.json().catch(function () { return {}; }).then(function (oBody) {
                if (!oResponse.ok) {
                    var sMsg = oBody && oBody.error && oBody.error.message;
                    throw new Error(sMsg || ("generarPdf HTTP " + oResponse.status));
                }
                return oBody;
            });
        });
    }

    /** Descarga el binario del PDF y lo guarda con el nombre indicado. */
    function downloadPdfStream(sGuid, sFileName) {
        return fetch(PDF_V4_SERVICE + "PdfStream(" + sGuid + ")/PdfData", {
            method: "GET",
            credentials: "same-origin"
        }).then(function (oResponse) {
            if (!oResponse.ok) {
                throw new Error("PdfData HTTP " + oResponse.status);
            }
            return oResponse.blob();
        }).then(function (oBlob) {
            if (!oBlob.size) {
                throw new Error("El PDF llego vacio");
            }
            var sUrl = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl;
            oLink.download = sFileName || "libro de compras.pdf";
            document.body.appendChild(oLink);
            oLink.click();
            document.body.removeChild(oLink);
            setTimeout(function () { URL.revokeObjectURL(sUrl); }, 1000);
        });
    }

    /** Periodo del filtro con 3 digitos ("1" -> "001"). Es obligatorio en el filtro. */
    function getPeriodForBackend() {
        var sPeriod = getFilterValue("FiscalPeriod").trim();
        if (!sPeriod) {
            return "";
        }
        return ("000" + sPeriod).slice(-3);
    }

    /* ============================================================ */
    /* Controlador de la extension                                  */
    /* ============================================================ */

    // IMPORTANTE: Fiori Elements V2 exige que la extension sea un objeto
    // simple ("plain object"); con Controller.extend los hooks no se ejecutan.
    return (
        {
            /**
             * Ciclo de vida: se ejecuta ademas del onInit del List Report.
             * Sin "return" ni async.
             */
            onInit: function () {
                rememberControls(this);
            },

            /**
             * Hook de Fiori Elements V2: el SmartFilterBar ya existe.
             */
            onInitSmartFilterBarExtension: function (oEvent) {
                rememberControls(this, oEvent && oEvent.getSource ? oEvent.getSource() : null);
                hookFilterBar();
                hideTableUntilSearch();
                // Deja listos los nombres de los filtros desde la carga inicial
                refreshForTaxType();
            },

            /**
             * Hook de Fiori Elements V2: se ejecuta antes de cada consulta
             * de la tabla (boton "Go", cambio de orden, etc.). Es el punto
             * donde el filtro Tipo de Impuesto ya esta confirmado.
             */
            onBeforeRebindTableExtension: function (oEvent) {
                var oSmartTable = oEvent && oEvent.getSource ? oEvent.getSource() : null;
                rememberControls(this, null, oSmartTable);
                var mBindingParams = oEvent && oEvent.getParameter ? oEvent.getParameter("bindingParams") : null;
                showTable();
                hookSmartTable(oSmartTable);
                safeRun(hideCurrencyInAmountCells, "hideCurrencyInAmountCells");
                safeRun(formatDateCells, "formatDateCells");
                if (guardRebind(oSmartTable, mBindingParams)) {
                    return;
                }
                ensureSelectForDynamicColumns(mBindingParams);
                safeRun(function () { applyDefaultSort(mBindingParams); }, "applyDefaultSort");
                safeRun(function () { applyPaging(oSmartTable, mBindingParams); }, "applyPaging");
                refreshForTaxType();
            },

            /**
             * Accion "Descargar PDF". Genera el PDF con el Adobe Form del
             * backend (accion RAP generarPdf, OData V4) y lo descarga.
             */
            onExportPdfBackend: function () {
                var oBundle = getResourceBundle();
                var mParams = {
                    CompanyCode: getFilterValue("P_CompanyCode").trim().toUpperCase(),
                    FiscalYear: getFilterValue("P_FiscalYear").trim(),
                    FiscalPeriod: getPeriodForBackend()
                };

                if (!mParams.CompanyCode || !mParams.FiscalYear || !mParams.FiscalPeriod) {
                    MessageToast.show(oBundle.getText("pdfBackendMissingParams"));
                    return;
                }

                BusyIndicator.show(0);
                fetchV4TokenAndNamespace()
                    .then(function (oCtx) {
                        return callGenerarPdf(oCtx, mParams);
                    })
                    .then(function (oResult) {
                        if (!oResult || !oResult.Guid) {
                            throw new Error("generarPdf no devolvio Guid");
                        }
                        return downloadPdfStream(oResult.Guid, oResult.FileName);
                    })
                    .catch(function (oError) {
                        console.error("[TaxReport] Error PDF backend:", oError);
                        MessageBox.error(oBundle.getText("pdfBackendError") + "\n\n" + (oError && oError.message || ""));
                    })
                    .finally(function () {
                        BusyIndicator.hide();
                    });
            }
        }
    );
});
