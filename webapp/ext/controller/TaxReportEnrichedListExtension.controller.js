sap.ui.define([
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (NumberFormat, BusyIndicator, Filter, FilterOperator, MessageToast, MessageBox) {
    "use strict";

    /*
     * Extension del List Report de Fiori Elements V2
     * (sap.suite.ui.generic.template.ListReport.view.ListReport).
     *
     * Responsabilidades:
     *  - Tipo de Impuesto fijo: SIEMPRE V (Input Tax). No hay filtro en
     *    pantalla; el valor solo selecciona las filas de TablaParametros.
     *  - Renombrar las columnas dinamicas C01..C15 con TablaParametros,
     *    usando solo las filas de la Sociedad y del Tipo de Impuesto
     *    seleccionados, y OCULTAR las columnas cN que no tengan fila.
     *  - Renombrar tambien los CAMPOS DE FILTRO C01..C15 (barra de filtros y
     *    "Adaptar filtros") y ocultar los que no tengan parametro.
     *  - La tabla permanece oculta hasta que se pulsa "Go", y se vuelve a
     *    ocultar apenas el usuario cambia cualquier filtro.
     *  - Si la combinacion Sociedad + Tipo de Impuesto no tiene ninguna
     *    columna en TablaParametros, NO se consulta ni se muestra ningun
     *    documento.
     *  - Las columnas sin parametro quedan BLOQUEADAS como ocultas (ni el
     *    redimensionado ni la personalizacion pueden volver a mostrarlas) y
     *    el redimensionado de columnas esta desactivado.
     *  - Los importes se muestran solo con el valor: la moneda ya tiene su
     *    propia columna ("Moneda"), no se repite junto a cada importe.
     *  - Titulo del reporte dinamico segun el Tipo de Impuesto.
     *  - Exportar el reporte a PDF.
     *
     * El estado vive a nivel de modulo (hay una sola instancia del List
     * Report) para no depender de a que "this" apunte el framework al
     * invocar los hooks de la extension.
     */

    var PDF_LIB_PATH = "yatl01/reportecolumnasdinamicas/ext/lib/";

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
        sTaxType: "",            // "V" | "A" | ""
        sCompany: "",            // sociedad del filtro (P_CompanyCode)
        mFilterItems: null,      // campos de filtro C01..C15 (SmartFilterBar)
        bFilterBarHooked: false,
        bSearched: false,        // true despues del primer "Go"
        mParametrosMap: null,    // fieldname(lowercase) -> descripcion
        bTableHooked: false,
        pPdfLibraries: null,
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
     * Impuesto indicado (no se pueden mezclar V y A). Toma la primera
     * aparicion de cada campo.
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

    function getTaxTypeText() {
        var oBundle = getResourceBundle();
        if (oState.sTaxType === "V") {
            return oBundle.getText("taxTypeInput");
        }
        if (oState.sTaxType === "A") {
            return oBundle.getText("taxTypeOutput");
        }
        return "";
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

    /** Aplica los anchos fijos de COLUMN_WIDTHS (NIT, Serie). */
    function applyColumnWidths() {
        var oSmartTable = getSmartTable();
        var oInner = oSmartTable && oSmartTable.getTable && oSmartTable.getTable();
        var aColumns = oInner && oInner.getColumns ? oInner.getColumns() : [];
        aColumns.forEach(function (oCol) {
            var sWidth = COLUMN_WIDTHS[getColumnKey(oCol).toLowerCase()];
            if (sWidth && oCol.getWidth() !== sWidth) {
                oCol.setWidth(sWidth);
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
        var fnReapply = function () {
            safeRun(applyReportTitle, "applyReportTitle");
            safeRun(applyColumnNames, "applyColumnNames");
            safeRun(applyColumnWidths, "applyColumnWidths");
            safeRun(hideCurrencyInAmountCells, "hideCurrencyInAmountCells");
            safeRun(formatDateCells, "formatDateCells");
            safeRun(disableColumnResize, "disableColumnResize");
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
    /* Exportacion a PDF                                            */
    /* ============================================================ */

    /**
     * Carga jsPDF y el plugin autotable una sola vez. Son librerias UMD
     * de terceros: se registran en el loader de UI5 como "shim".
     */
    function loadPdfLibraries() {
        if (!oState.pPdfLibraries) {
            var mShim = {};
            mShim[PDF_LIB_PATH + "jspdf.umd.min"] = {
                amd: false,
                exports: "jspdf"
            };
            mShim[PDF_LIB_PATH + "jspdf.plugin.autotable.min"] = {
                amd: false,
                deps: [PDF_LIB_PATH + "jspdf.umd.min"]
            };
            sap.ui.loader.config({ shim: mShim });
            oState.pPdfLibraries = new Promise(function (fnResolve, fnReject) {
                sap.ui.require([
                    PDF_LIB_PATH + "jspdf.umd.min",
                    PDF_LIB_PATH + "jspdf.plugin.autotable.min"
                ], function () {
                    if (window.jspdf && window.jspdf.jsPDF) {
                        fnResolve(window.jspdf.jsPDF);
                    } else {
                        fnReject(new Error("jsPDF no quedo disponible en window.jspdf"));
                    }
                }, fnReject);
            });
        }
        return oState.pPdfLibraries;
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

    /** Fecha del registro como dd.mm.aaaa (respaldo si el servicio no trae DocumentDateFormatted). */
    function formatDocumentDate(oRow) {
        return oRow.DocumentDateFormatted
            ? String(oRow.DocumentDateFormatted)
            : formatDateDDMMYYYY(oRow.DocumentDate);
    }

    /** TIPO = descripcion del tipo de documento + " - " + codigo SAT (ej. "FACTURA - FACT"). */
    function formatDocumentType(oRow) {
        return [oRow.DescTipoDocumento, oRow.TipDocSat]
            .map(function (sValue) { return String(sValue || "").trim(); })
            .filter(Boolean)
            .join(" - ");
    }

    /** Columnas C01..C99 mapeadas para el filtro actual, en orden numerico. */
    function getMappedDynamicKeys() {
        return Object.keys(oState.mParametrosMap || {})
            .filter(function (sKey) { return /^c\d+$/i.test(sKey); })
            .sort(function (a, b) { return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10); });
    }

    /**
     * Columnas del PDF: lista FIJA y en orden FIJO, independiente de las
     * columnas que el usuario muestre u oculte en la tabla. Los importes
     * dinamicos son los C01..C99 mapeados, entre PROVEEDOR e IVA. Todos los
     * encabezados del PDF son azules (headStyles).
     * Cada columna: header, value(oRow, iIndex) para texto o key + isAmount
     * para importes, dynamic y select (campos OData).
     */
    function getPdfColumns() {
        var aColumns = [
            { header: "#", value: function (oRow, iIndex) { return String(iIndex + 1); }, select: [] },
            { header: "DÍA", value: formatDocumentDate, select: ["DocumentDateFormatted", "DocumentDate"] },
            { header: "TIPO", value: formatDocumentType, select: ["DescTipoDocumento", "TipDocSat"] },
            { header: "SERIE", key: "Serie" },
            { header: "NO. DOCUMENTO", key: "DocumentReferenceID" },
            { header: "NIT", key: "Nit" },
            { header: "PROVEEDOR", key: "Proveedor", isTotalLabel: true }
        ];
        getMappedDynamicKeys().forEach(function (sKey) {
            aColumns.push({
                header: oState.mParametrosMap[sKey],
                key: sKey.toUpperCase(),
                isAmount: true,
                dynamic: true
            });
        });
        aColumns.push(
            { header: "IVA", key: "ImporteIVA", isAmount: true },
            { header: "TOTAL", key: "Total", isAmount: true },
            { header: "No. PROVEEDOR", key: "NoProveedor" },
            { header: "Nro. Documento FI", key: "AccountingDocument" }
        );
        return aColumns.map(function (oCol) {
            oCol.isAmount = !!oCol.isAmount;
            oCol.dynamic = !!oCol.dynamic;
            oCol.select = oCol.select || [oCol.key];
            return oCol;
        });
    }

    /** Valor ya formateado de una columna del PDF para una fila. */
    function getPdfCellValue(oCol, oRow, iIndex) {
        return oCol.value
            ? oCol.value(oRow, iIndex)
            : formatCellValue(oRow[oCol.key], oCol.isAmount);
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

    function collectReportData() {
        var oSmartTable = getSmartTable();
        if (!oSmartTable) {
            return Promise.reject(new Error("No se encontro la tabla del reporte"));
        }
        var aColumns = getPdfColumns();
        var aSelect = ["CompanyCodeCurrency"];
        aColumns.forEach(function (oCol) {
            oCol.select.forEach(function (sField) {
                if (aSelect.indexOf(sField) === -1) {
                    aSelect.push(sField);
                }
            });
        });

        return requestAllRows(oSmartTable, aSelect).then(function (aRawRows) {
            var aRows = aRawRows.map(function (oRow, iIndex) {
                return aColumns.map(function (oCol) {
                    return getPdfCellValue(oCol, oRow, iIndex);
                });
            });
            return {
                title: getReportTitle(),
                taxType: oState.sTaxType,
                taxTypeText: getTaxTypeText(),
                recordCount: String(aRows.length),
                companyCode: getFilterValue("P_CompanyCode"),
                fiscalYear: getFilterValue("P_FiscalYear"),
                columns: aColumns,
                rows: aRows,
                rawRows: aRawRows
            };
        });
    }

    /**
     * Fila de totales para el pie del PDF. Solo totaliza si todas las
     * filas comparten la misma moneda. Devuelve null si no aplica.
     */
    function buildTotalsRow(oData) {
        if (!oData.rows.length || !oData.columns.some(function (oCol) { return oCol.isAmount; })) {
            return null;
        }
        var mCurrencies = {};
        oData.rawRows.forEach(function (oRow) {
            if (oRow && oRow.CompanyCodeCurrency) {
                mCurrencies[oRow.CompanyCodeCurrency] = true;
            }
        });
        var aCurrencies = Object.keys(mCurrencies);
        if (aCurrencies.length > 1) {
            return null;
        }

        var aTotals = oData.columns.map(function () { return 0; });
        oData.rawRows.forEach(function (oRow) {
            oData.columns.forEach(function (oCol, iIndex) {
                if (oCol.isAmount) {
                    var f = parseFloat(oRow[oCol.key]);
                    if (!isNaN(f)) {
                        aTotals[iIndex] += f;
                    }
                }
            });
        });

        return [oData.columns.map(function (oCol, iIndex) {
            if (oCol.isAmount) {
                return getAmountFormatter().format(aTotals[iIndex]);
            }
            // La etiqueta "TOTAL" va en la columna PROVEEDOR
            return oCol.isTotalLabel ? "TOTAL" : "";
        })];
    }

    function buildFileName(oData) {
        var aParts = ["LibroDeCompras"];
        if (oData.taxTypeText) {
            aParts.push(oData.taxTypeText.replace(/\s+/g, ""));
        }
        if (oData.companyCode) {
            aParts.push(oData.companyCode);
        }
        if (oData.fiscalYear) {
            aParts.push(oData.fiscalYear);
        }
        var oNow = new Date();
        aParts.push(oNow.getFullYear()
            + ("0" + (oNow.getMonth() + 1)).slice(-2)
            + ("0" + oNow.getDate()).slice(-2)
            + "_"
            + ("0" + oNow.getHours()).slice(-2)
            + ("0" + oNow.getMinutes()).slice(-2));
        return aParts.join("_") + ".pdf";
    }

    /**
     * Genera el PDF con jsPDF + autotable: encabezado con titulo y
     * contexto, tabla con las columnas visibles, totales y numeracion.
     */
    function generatePdf(oData) {
        var JsPDF = window.jspdf.jsPDF;
        var oDoc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
        var iPageWidth = oDoc.internal.pageSize.getWidth();
        var iPageHeight = oDoc.internal.pageSize.getHeight();
        var iMargin = 40;

        oDoc.setFontSize(14);
        oDoc.setTextColor(10, 110, 209);
        oDoc.text(oData.title, iMargin, 42);

        oDoc.setFontSize(9);
        oDoc.setTextColor(90);
        var aSubtitle = [];
        if (oData.companyCode) {
            aSubtitle.push("Sociedad: " + oData.companyCode);
        }
        if (oData.fiscalYear) {
            aSubtitle.push("Ejercicio: " + oData.fiscalYear);
        }
        if (oData.taxTypeText) {
            aSubtitle.push(getResourceBundle().getText("pdfTaxTypeLabel") + ": " + oData.taxTypeText);
        }
        aSubtitle.push("Registros: " + oData.recordCount);
        aSubtitle.push("Emitido: " + new Date().toLocaleString());
        oDoc.text(aSubtitle.join("    |    "), iMargin, 58);

        var oColumnStyles = {};
        oData.columns.forEach(function (oCol, iIndex) {
            if (oCol.isAmount) {
                oColumnStyles[iIndex] = { halign: "right" };
            }
        });

        oDoc.autoTable({
            head: [oData.columns.map(function (oCol) { return oCol.header; })],
            body: oData.rows,
            foot: buildTotalsRow(oData),
            startY: 70,
            margin: { left: iMargin, right: iMargin },
            styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
            headStyles: { fillColor: [10, 110, 209], textColor: 255, fontStyle: "bold" },
            footStyles: { fillColor: [230, 240, 250], textColor: 30, fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 247, 250] },
            columnStyles: oColumnStyles,
            showFoot: "lastPage"
        });

        var iTotalPages = oDoc.internal.getNumberOfPages();
        for (var i = 1; i <= iTotalPages; i++) {
            oDoc.setPage(i);
            oDoc.setFontSize(8);
            oDoc.setTextColor(130);
            oDoc.text("Página " + i + " de " + iTotalPages, iPageWidth - iMargin, iPageHeight - 12, { align: "right" });
        }

        oDoc.save(buildFileName(oData));
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
                refreshForTaxType();
            },

            /**
             * Accion "Exportar PDF" de la toolbar (manifest.json ->
             * controllerExtensions -> Actions -> exportPdf -> press).
             */
            onExportPdf: function () {
                var oBundle = getResourceBundle();

                BusyIndicator.show(0);
                // Se asegura que Tipo de Impuesto/titulo/encabezados esten al dia
                refreshForTaxType()
                    .then(loadPdfLibraries)
                    .then(collectReportData)
                    .then(function (oData) {
                        if (!oData.rows.length) {
                            MessageToast.show(oBundle.getText("pdfNoData"));
                            return;
                        }
                        generatePdf(oData);
                    })
                    .catch(function (oError) {
                        console.error("[TaxReport] Error al generar PDF:", oError);
                        MessageBox.error(oBundle.getText("pdfError"));
                    })
                    .finally(function () {
                        BusyIndicator.hide();
                    });
            }
        }
    );
});
