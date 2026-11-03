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
     *  - Filtro "Tipo de Impuesto": V = Input Tax, A = Output Tax. Es un
     *    campo personalizado de la app (ext/fragment/TaxTypeFilter), NO un
     *    parametro del servicio; su lista sale de I_TaxType.
     *  - Renombrar las columnas dinamicas c1..c9 con TablaParametros,
     *    usando solo las filas de la Sociedad y del Tipo de Impuesto
     *    seleccionados, y OCULTAR las columnas cN que no tengan fila.
     *  - Renombrar tambien los CAMPOS DE FILTRO c1..c9 (barra de filtros y
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
        oTaxTypeSelect: null,    // selector personalizado de Tipo de Impuesto
        mFilterItems: null,      // campos de filtro c1..c9 (SmartFilterBar)
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

    /**
     * Selector personalizado "Tipo de Impuesto" (fragmento TaxTypeFilter).
     * Al cambiar su valor se recalculan nombres, columnas visibles y
     * titulo de inmediato (no requiere volver a consultar el servicio).
     */
    function getTaxTypeSelect() {
        if (oState.oTaxTypeSelect) {
            return oState.oTaxTypeSelect;
        }
        var oView = oState.oView;
        if (!oView) {
            return null;
        }
        var aFound = oView.findAggregatedObjects(true, function (oControl) {
            return oControl.isA && oControl.isA("sap.m.Select")
                && /taxTypeSelect$/.test(oControl.getId());
        });
        if (aFound.length) {
            oState.oTaxTypeSelect = aFound[0];
            oState.oTaxTypeSelect.attachChange(function () {
                hideResultsOnFilterChange();
                refreshForTaxType();
            });
        }
        return oState.oTaxTypeSelect;
    }

    function getTaxTypeValue() {
        var oSelect = getTaxTypeSelect();
        return oSelect ? String(oSelect.getSelectedKey() || "") : "";
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

    /** Clave de columna (c1, c2, ...) de una sap.m.Column de la SmartTable. */
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

    function getColumnHeaderText(oCol) {
        var oHeader = oCol.getHeader && oCol.getHeader();
        return oHeader && oHeader.getText ? oHeader.getText() : "";
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

    /** Asigna el encabezado dinamico a cada columna cN con descripcion. */
    function applyColumnNames() {
        var oSmartTable = getSmartTable();
        var mMap = oState.mParametrosMap;
        if (!oSmartTable || !mMap) {
            return;
        }
        var oInner = oSmartTable.getTable && oSmartTable.getTable();
        var aColumns = oInner && oInner.getColumns ? oInner.getColumns() : [];
        aColumns.forEach(function (oCol) {
            var sKey = getColumnKey(oCol).toLowerCase();
            var sDesc = mMap[sKey];

            // Columnas dinamicas (c1..c9): sin fila en TablaParametros para el
            // filtro actual -> no deben aparecer.
            if (/^c\d+$/.test(sKey)) {
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
            applyColumnNames();
            applyFilterItems();
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
            if (/^c\d+$/.test(sKey) && aSelect.indexOf(sKey) === -1) {
                aSelect.push(sKey);
            }
        });
        oParams.select = aSelect.join(",");
    }

    /**
     * Renombra los campos de filtro c1..c9 con la descripcion de
     * TablaParametros y oculta los que no tienen parametro para el Tipo de
     * Impuesto / Sociedad actuales (tambien en "Adaptar filtros"). Tambien
     * oculta las copias duplicadas de Sociedad y Ejercicio.
     */
    function applyFilterItems() {
        var oFilterBar = getFilterBar();
        var mMap = oState.mParametrosMap;
        if (!oFilterBar || !mMap) {
            return;
        }
        // Un item oculto deja de aparecer en getAllFilterItems: se guardan
        // las referencias la primera vez para poder volver a mostrarlos.
        if (!oState.mFilterItems) {
            oState.mFilterItems = {};
            oFilterBar.getAllFilterItems(false).forEach(function (oItem) {
                var sName = oItem.getName();
                if (/^c\d+$/i.test(sName)) {
                    oState.mFilterItems[sName.toLowerCase()] = oItem;
                } else if (sName === "P_CompanyCode" || sName === "P_FiscalYear") {
                    oItem.setVisible(false);
                }
            });
        }
        Object.keys(oState.mFilterItems).forEach(function (sKey) {
            var oItem = oState.mFilterItems[sKey];
            var sDesc = mMap[sKey];
            if (sDesc) {
                oItem.setLabel(sDesc);
                oItem.setVisible(true);
            } else if (oItem.getVisible()) {
                // Si el usuario habia filtrado por este campo, se limpia el
                // valor para que no filtre en silencio algo que ya no se ve.
                var mData = oFilterBar.getFilterData() || {};
                if (mData[oItem.getName()]) {
                    var mClear = {};
                    mClear[oItem.getName()] = null;
                    oFilterBar.setFilterData(mClear);
                }
                oItem.setVisible(false);
            }
        });
    }

    /**
     * Los importes (c1..c9) llevan la unidad TransactionCurrency en el
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
                    return oPart.path === "TransactionCurrency";
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

    function getParametrosKey(sCompany, sTaxType) {
        return (sCompany || "") + "|" + (sTaxType || "");
    }

    /** Hay al menos una columna dinamica (cN) mapeada en el mapa. */
    function hasMappedColumns(mMap) {
        return Object.keys(mMap || {}).some(function (sKey) {
            return /^c\d+$/.test(sKey);
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
        disableColumnResize();
        var fnReapply = function () {
            applyReportTitle();
            applyColumnNames();
            hideCurrencyInAmountCells();
            disableColumnResize();
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

    /**
     * Columnas VISIBLES de la tabla (orden y encabezado actuales).
     */
    function getVisibleColumns(oSmartTable) {
        var oInner = oSmartTable.getTable();
        return (oInner.getColumns() || [])
            .filter(function (oCol) {
                return oCol.getVisible && oCol.getVisible();
            })
            .map(function (oCol) {
                var sKey = getColumnKey(oCol);
                return {
                    key: sKey,
                    header: getColumnHeaderText(oCol) || sKey,
                    // Las columnas dinamicas c1..cN son importes (Edm.Decimal)
                    isAmount: /^c\d+$/i.test(sKey)
                };
            });
    }

    /**
     * Pide TODAS las filas que coinciden con los filtros actuales
     * (no solo las que muestra la tabla con paginacion), reutilizando la
     * ruta, filtros y orden del binding de la tabla.
     */
    function requestAllRows(oSmartTable) {
        var oInner = oSmartTable.getTable();
        var oInfo = oInner.getBindingInfo("items") || oInner.getBindingInfo("rows");
        var oModel = oSmartTable.getModel();
        if (!oInfo || !oModel) {
            return Promise.reject(new Error("El binding de la tabla no esta disponible"));
        }
        var aSorters = oInfo.sorter ? [].concat(oInfo.sorter) : [];
        var aFilters = oInfo.filters ? [].concat(oInfo.filters) : [];
        var mUrlParameters = {};
        var sSelect = oInfo.parameters && oInfo.parameters.select;
        if (sSelect) {
            mUrlParameters.$select = sSelect;
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
        var aColumns = getVisibleColumns(oSmartTable);

        return requestAllRows(oSmartTable).then(function (aRawRows) {
            var aRows = aRawRows.map(function (oRow) {
                return aColumns.map(function (oCol) {
                    return formatCellValue(oRow[oCol.key], oCol.isAmount);
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
            if (oRow && oRow.TransactionCurrency) {
                mCurrencies[oRow.TransactionCurrency] = true;
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
            return iIndex === 0 ? "Total" : "";
        })];
    }

    function buildFileName(oData) {
        var aParts = ["ReporteTax"];
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
                getTaxTypeSelect();
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
                hideCurrencyInAmountCells();
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
