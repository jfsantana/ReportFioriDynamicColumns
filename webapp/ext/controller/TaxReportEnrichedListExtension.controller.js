sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (ControllerExtension, NumberFormat, BusyIndicator, MessageToast, MessageBox) {
    "use strict";

    return ControllerExtension.extend(
        "yatl01.reportecolumnasdinamicas.ext.controller.TaxReportEnrichedListExtension",
        {
            _mParametrosMap: null,
            _pPdfLibraries: null,
            _oAmountFormatter: null,

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

            /* ============================================================ */
            /* Exportación del reporte a PDF                                */
            /* ============================================================ */

            /**
             * Manejador del botón "Exportar PDF" de la toolbar de la tabla.
             * Está referenciado desde manifest.json (controlConfiguration ->
             * LineItem -> actions -> exportPdf), por eso NO va dentro de
             * "override": Fiori Elements lo invoca como método público de
             * esta extensión de controlador.
             */
            onExportPdf: function () {
                var that = this;
                var oBundle = this._getResourceBundle();

                BusyIndicator.show(0);
                this._loadPdfLibraries()
                    .then(function () {
                        return that._collectReportData();
                    })
                    .then(function (oData) {
                        if (!oData.rows.length) {
                            MessageToast.show(oBundle.getText("pdfNoData"));
                            return;
                        }
                        that._generatePdf(oData);
                    })
                    .catch(function (oError) {
                        console.error("[TaxReport] Error al generar PDF:", oError);
                        MessageBox.error(oBundle.getText("pdfError"));
                    })
                    .finally(function () {
                        BusyIndicator.hide();
                    });
            },

            /**
             * Carga jsPDF y el plugin autotable una sola vez (carga perezosa).
             * Son librerías UMD de terceros, no módulos UI5: por eso se
             * registran en el loader de UI5 como "shim" (amd:false), donde
             * jsPDF expone el global window.jspdf y autotable lo extiende.
             * El "deps" de autotable garantiza que jsPDF se ejecute primero.
             * Al vivir dentro del namespace de la app, las rutas resuelven
             * igual en el Fiori Launchpad y en ejecución standalone.
             */
            _loadPdfLibraries: function () {
                if (!this._pPdfLibraries) {
                    sap.ui.loader.config({
                        shim: {
                            "yatl01/reportecolumnasdinamicas/ext/lib/jspdf.umd.min": {
                                amd: false,
                                exports: "jspdf"
                            },
                            "yatl01/reportecolumnasdinamicas/ext/lib/jspdf.plugin.autotable.min": {
                                amd: false,
                                deps: ["yatl01/reportecolumnasdinamicas/ext/lib/jspdf.umd.min"]
                            }
                        }
                    });
                    this._pPdfLibraries = new Promise(function (fnResolve, fnReject) {
                        sap.ui.require([
                            "yatl01/reportecolumnasdinamicas/ext/lib/jspdf.umd.min",
                            "yatl01/reportecolumnasdinamicas/ext/lib/jspdf.plugin.autotable.min"
                        ], function () {
                            if (window.jspdf && window.jspdf.jsPDF) {
                                fnResolve(window.jspdf.jsPDF);
                            } else {
                                fnReject(new Error("jsPDF no quedó disponible en window.jspdf"));
                            }
                        }, fnReject);
                    });
                }
                return this._pPdfLibraries;
            },

            /**
             * Reúne todo lo necesario para el PDF:
             *  - columnas VISIBLES de la MDC Table, en su orden actual y con
             *    el encabezado ya renombrado dinámicamente (Gasolina, etc.)
             *  - TODAS las filas que coinciden con los filtros actuales,
             *    pedidas al binding de la tabla (no solo las renderizadas)
             *  - título del reporte y valores de Sociedad / Ejercicio
             */
            _collectReportData: function () {
                var that = this;
                var oTable = this._findMdcTable();
                if (!oTable) {
                    return Promise.reject(new Error("No se encontró la tabla del reporte"));
                }

                var aColumns = (oTable.getColumns() || [])
                    .filter(function (oCol) {
                        return oCol.getVisible && oCol.getVisible();
                    })
                    .map(function (oCol) {
                        var sProp = (oCol.getPropertyKey && oCol.getPropertyKey()) || "";
                        if (!sProp && typeof oCol.getDataProperty === "function") {
                            sProp = oCol.getDataProperty() || "";
                        }
                        if (!sProp) {
                            var sId = oCol.getId() || "";
                            sProp = sId.indexOf("::") !== -1 ? sId.split("::").pop() : sId;
                        }
                        return {
                            key: sProp,
                            header: (oCol.getHeader && oCol.getHeader()) || sProp,
                            // Las columnas dinámicas c1..cN son importes (Edm.Decimal)
                            isAmount: /^c\d+$/i.test(sProp)
                        };
                    });

                var oBinding = oTable.getRowBinding && oTable.getRowBinding();
                if (!oBinding) {
                    return Promise.reject(new Error("El binding de la tabla no está disponible"));
                }

                var iLength = oBinding.getLength ? oBinding.getLength() : 0;
                if (!iLength) {
                    return Promise.resolve(this._buildReportData(oTable, aColumns, []));
                }

                // requestContexts respeta filtros, orden y parámetros actuales
                // del binding y devuelve una promesa con los contextos pedidos.
                return oBinding.requestContexts(0, iLength).then(function (aContexts) {
                    var aRawRows = aContexts.map(function (oCtx) {
                        return oCtx.getObject ? oCtx.getObject() : {};
                    });
                    var aRows = aRawRows.map(function (oRow) {
                        return aColumns.map(function (oCol) {
                            return that._formatCellValue(oRow[oCol.key], oCol.isAmount, oRow.TransactionCurrency);
                        });
                    });
                    return that._buildReportData(oTable, aColumns, aRows, aRawRows);
                });
            },

            _buildReportData: function (oTable, aColumns, aRows, aRawRows) {
                // El header de la tabla viene como "Reporte Tax (66)"; separamos
                // el contador para mostrarlo como dato informativo en el PDF.
                var sHeader = (oTable.getHeader && oTable.getHeader()) || "Reporte Tax";
                var mMatch = sHeader.match(/^(.*?)\s*\((\d+)\)\s*$/);
                return {
                    title: mMatch ? mMatch[1] : sHeader,
                    recordCount: mMatch ? mMatch[2] : String(aRows.length),
                    companyCode: this._getFilterValue("P_CompanyCode"),
                    fiscalYear: this._getFilterValue("P_FiscalYear"),
                    columns: aColumns,
                    rows: aRows,
                    rawRows: aRawRows || []
                };
            },

            /**
             * Da formato a una celda: los importes se muestran con separador
             * de miles, 2 decimales y la moneda de la fila (igual que en la
             * tabla, p. ej. "1,071.43 GTQ"); el resto va como texto plano.
             */
            _formatCellValue: function (vValue, bIsAmount, sCurrency) {
                if (vValue === null || vValue === undefined || vValue === "") {
                    return "";
                }
                if (bIsAmount) {
                    var fNumber = parseFloat(vValue);
                    if (!isNaN(fNumber)) {
                        var sFormatted = this._getAmountFormatter().format(fNumber);
                        return sCurrency ? sFormatted + " " + sCurrency : sFormatted;
                    }
                }
                return String(vValue);
            },

            _getAmountFormatter: function () {
                if (!this._oAmountFormatter) {
                    this._oAmountFormatter = NumberFormat.getFloatInstance({
                        minFractionDigits: 2,
                        maxFractionDigits: 2,
                        groupingEnabled: true
                    });
                }
                return this._oAmountFormatter;
            },

            /**
             * Lee el valor actual de un campo del Filter Bar (P_CompanyCode,
             * P_FiscalYear) desde las condiciones del filtro, para imprimirlo
             * como contexto en el encabezado del PDF.
             */
            _getFilterValue: function (sFieldName) {
                try {
                    var oView = this.base.getView ? this.base.getView() : null;
                    if (!oView) {
                        return "";
                    }
                    var aFilterBars = oView.findAggregatedObjects(true, function (oControl) {
                        return oControl.isA && oControl.isA("sap.ui.mdc.FilterBar");
                    });
                    if (!aFilterBars.length) {
                        return "";
                    }
                    var mConditions = aFilterBars[0].getFilterConditions() || {};
                    var aConditions = mConditions[sFieldName] || [];
                    if (aConditions.length && aConditions[0].values && aConditions[0].values.length) {
                        return String(aConditions[0].values[0]);
                    }
                } catch (oError) {
                    console.warn("[TaxReport] No se pudo leer el filtro " + sFieldName, oError);
                }
                return "";
            },

            /**
             * Genera el PDF con jsPDF + autotable: encabezado con título y
             * contexto (sociedad, ejercicio, fecha), tabla con las columnas
             * visibles, fila de totales por columna de importe y pie con
             * numeración de páginas.
             */
            _generatePdf: function (oData) {
                var JsPDF = window.jspdf.jsPDF;
                var oDoc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

                var iPageWidth = oDoc.internal.pageSize.getWidth();
                var iPageHeight = oDoc.internal.pageSize.getHeight();
                var iMargin = 40;

                // Encabezado del documento
                oDoc.setFontSize(14);
                oDoc.setTextColor(10, 110, 209); // azul SAP Horizon
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
                aSubtitle.push("Registros: " + oData.recordCount);
                aSubtitle.push("Emitido: " + new Date().toLocaleString());
                oDoc.text(aSubtitle.join("    |    "), iMargin, 58);

                // Alineación derecha para columnas de importe
                var oColumnStyles = {};
                oData.columns.forEach(function (oCol, iIndex) {
                    if (oCol.isAmount) {
                        oColumnStyles[iIndex] = { halign: "right" };
                    }
                });

                // Totales por columna de importe (solo si todas las filas
                // comparten la misma moneda, para no sumar peras con manzanas)
                var aFoot = this._buildTotalsRow(oData);

                oDoc.autoTable({
                    head: [oData.columns.map(function (oCol) { return oCol.header; })],
                    body: oData.rows,
                    foot: aFoot,
                    startY: 70,
                    margin: { left: iMargin, right: iMargin },
                    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
                    headStyles: { fillColor: [10, 110, 209], textColor: 255, fontStyle: "bold" },
                    footStyles: { fillColor: [230, 240, 250], textColor: 30, fontStyle: "bold" },
                    alternateRowStyles: { fillColor: [245, 247, 250] },
                    columnStyles: oColumnStyles,
                    showFoot: "lastPage"
                });

                // Pie de página con numeración "Página X de Y"
                var iTotalPages = oDoc.internal.getNumberOfPages();
                for (var i = 1; i <= iTotalPages; i++) {
                    oDoc.setPage(i);
                    oDoc.setFontSize(8);
                    oDoc.setTextColor(130);
                    oDoc.text("Página " + i + " de " + iTotalPages, iPageWidth - iMargin, iPageHeight - 12, { align: "right" });
                }

                oDoc.save(this._buildFileName(oData));
            },

            /**
             * Construye la fila de totales para el pie de la tabla del PDF.
             * Solo totaliza si todas las filas comparten la misma moneda
             * (para no sumar importes de monedas distintas). Devuelve null
             * si no hay columnas de importe o no hay filas.
             */
            _buildTotalsRow: function (oData) {
                if (!oData.rows.length) {
                    return null;
                }
                var bHasAmount = oData.columns.some(function (oCol) { return oCol.isAmount; });
                if (!bHasAmount) {
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
                var sCurrency = aCurrencies[0] || "";

                var aTotals = oData.columns.map(function () { return 0; });
                oData.rawRows.forEach(function (oRow) {
                    if (!oRow) {
                        return;
                    }
                    oData.columns.forEach(function (oCol, iIndex) {
                        if (oCol.isAmount) {
                            var f = parseFloat(oRow[oCol.key]);
                            if (!isNaN(f)) {
                                aTotals[iIndex] += f;
                            }
                        }
                    });
                });

                var that = this;
                var aFootRow = oData.columns.map(function (oCol, iIndex) {
                    if (oCol.isAmount) {
                        var sFormatted = that._getAmountFormatter().format(aTotals[iIndex]);
                        return sCurrency ? sFormatted + " " + sCurrency : sFormatted;
                    }
                    return iIndex === 0 ? "Total" : "";
                });
                return [aFootRow];
            },

            _buildFileName: function (oData) {
                var aParts = ["ReporteTax"];
                if (oData.companyCode) {
                    aParts.push(oData.companyCode);
                }
                if (oData.fiscalYear) {
                    aParts.push(oData.fiscalYear);
                }
                var oNow = new Date();
                var sStamp = oNow.getFullYear()
                    + ("0" + (oNow.getMonth() + 1)).slice(-2)
                    + ("0" + oNow.getDate()).slice(-2)
                    + "_"
                    + ("0" + oNow.getHours()).slice(-2)
                    + ("0" + oNow.getMinutes()).slice(-2);
                aParts.push(sStamp);
                return aParts.join("_") + ".pdf";
            },

            _getResourceBundle: function () {
                var oView = this.base.getView ? this.base.getView() : null;
                var oModel = oView && oView.getModel ? oView.getModel("i18n") : null;
                return oModel ? oModel.getResourceBundle() : {
                    getText: function (sKey) { return sKey; }
                };
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