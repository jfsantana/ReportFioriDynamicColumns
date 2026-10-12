sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension"
], function (ControllerExtension) {
    "use strict";

    return ControllerExtension.extend(
        "yatl01.reportecolumnasdinamicas.ext.controller.TaxReportEnrichedListExtension",
        {
            _mParametrosMap: null,

            override: {
                /**
                 * Se ejecuta al inicializar el controlador.
                 * IMPORTANTE: No debe tener ningún 'return' ni ser 'async'
                 * para evitar el error [FUTURE FATAL] en UI5 1.130+.
                 */
                onInit: function () {
                    this._loadAndApplyDynamicColumns();
                },

                /**
                 * Se ejecuta después de cada renderizado de la vista.
                 * Asegura que si la tabla se re-renderiza, los encabezados se mantengan.
                 */
                onAfterRendering: function () {
                    if (this._mParametrosMap) {
                        this._applyColumnNames(this._mParametrosMap);
                    }
                }
            },

            /**
             * Lee la entidad /TablaParametros mediante el modelo OData V4
             * y construye el mapa FieldName -> DescripcionGrup tomando la primera aparición.
             */
            _loadAndApplyDynamicColumns: function () {
                var that = this;
                var oView = this.base.getView ? this.base.getView() : null;
                if (!oView) {
                    return;
                }

                var oModel = oView.getModel ? oView.getModel() : null;
                if (!oModel) {
                    setTimeout(function () {
                        that._loadAndApplyDynamicColumns();
                    }, 300);
                    return;
                }

                var oListBinding = oModel.bindList("/TablaParametros");

                oListBinding.requestContexts(0, 100).then(function (aContexts) {
                    var mMap = {};
                    aContexts.forEach(function (oCtx) {
                        var oData = oCtx.getObject ? oCtx.getObject() : oCtx;
                        var sField = (oData.FieldName || oData.field_name || oData.fieldname || "").trim().toLowerCase();
                        var sDesc = (oData.DescripcionGrup || oData.descripcion_grupo || oData.descripciongrup || "").trim();

                        // Toma el primer valor si C1 u otro campo aparece múltiples veces
                        if (sField && sDesc && !mMap[sField]) {
                            mMap[sField] = sDesc;
                        }
                    });

                    that._mParametrosMap = mMap;
                    that._waitForTableAndApply(mMap);
                }).catch(function (oError) {
                    console.error("[TaxReport] Error al leer TablaParametros:", oError);
                });
            },

            /**
             * Espera a que la MDC Table (sap.ui.mdc.Table) esté lista e inicializada
             * antes de renombrar las columnas.
             */
            _waitForTableAndApply: function (mMap) {
                var that = this;
                var oTable = this._findMdcTable();

                if (!oTable) {
                    if (this.base.pageReady && typeof this.base.pageReady.waitPageReady === "function") {
                        this.base.pageReady.waitPageReady().then(function () {
                            that._waitForTableAndApply(mMap);
                        });
                    } else {
                        setTimeout(function () {
                            that._waitForTableAndApply(mMap);
                        }, 300);
                    }
                    return;
                }

                if (oTable.initialized) {
                    oTable.initialized().then(function () {
                        that._applyColumnNames(mMap);
                    });
                } else {
                    this._applyColumnNames(mMap);
                }
            },

            /**
             * Asigna el nuevo encabezado a cada columna que coincida con el mapa.
             */
            _applyColumnNames: function (mMap) {
                if (!mMap) {
                    return;
                }

                var oTable = this._findMdcTable();
                if (!oTable) {
                    return;
                }

                var aColumns = oTable.getColumns ? oTable.getColumns() : [];
                aColumns.forEach(function (oCol) {
                    // En sap.ui.mdc.table.Column se usa getPropertyKey() o el id final
                    var sProp = (oCol.getPropertyKey && oCol.getPropertyKey()) || "";
                    if (!sProp && typeof oCol.getDataProperty === "function") {
                        sProp = oCol.getDataProperty() || "";
                    }
                    if (!sProp) {
                        var sId = oCol.getId() || "";
                        sProp = sId.indexOf("::") !== -1 ? sId.split("::").pop() : sId;
                    }
                    sProp = sProp.trim().toLowerCase();

                    if (sProp && mMap[sProp]) {
                        oCol.setHeader(mMap[sProp]);
                    }
                });
            },

            /**
             * Localiza el control sap.ui.mdc.Table en la vista actual del ListReport.
             */
            _findMdcTable: function () {
                if (this.base._getTable && typeof this.base._getTable === "function") {
                    var oTbl = this.base._getTable();
                    if (oTbl) {
                        return oTbl;
                    }
                }

                var oView = this.base.getView ? this.base.getView() : null;
                if (!oView) {
                    return null;
                }

                var aFound = oView.findAggregatedObjects(true, function (oControl) {
                    return oControl.isA && oControl.isA("sap.ui.mdc.Table");
                });
                return aFound && aFound.length > 0 ? aFound[0] : null;
            }
        }
    );
});