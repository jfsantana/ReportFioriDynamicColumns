sap.ui.define([], function () {
    "use strict";

    /*
     * Agrupacion en el navegador de las filas del Libro de Compras.
     *
     * El servicio devuelve una fila por factura E INDICADOR DE IMPUESTO
     * (TaxCode). La vista por defecto debe mostrar UNA fila por factura con
     * los importes sumados; si el usuario agrega una columna que distingue las
     * lineas (Indicador de impuesto, Nombre del indicador, Pos. impuestos) la
     * tabla vuelve a separar por esa columna.
     *
     * Regla: las filas se agrupan por el valor de las columnas que el usuario ve
     * (mas la identidad del documento) y las columnas numericas se suman. Los
     * demas campos del $select (por ejemplo las claves de la entidad, que el
     * SmartTable pide siempre) NO cuentan: pueden variar entre las lineas de una
     * misma factura aunque no se vean.
     * Modulo sin dependencias de UI para poder probarlo aislado.
     */

    // Columnas que identifican una linea de impuesto dentro de la factura.
    // Valores por defecto (Compras GT); el controlador los toma de la
    // configuracion del libro con configure().
    var LINE_LEVEL_FIELDS = ["taxcode", "taxcodename", "taxitem"];

    // Campos numericos fijos (ademas de C01..C99)
    var AMOUNT_FIELDS = ["importeiva", "total"];

    function toLowerList(aFields) {
        return (aFields || []).filter(Boolean).map(function (sField) {
            return String(sField).toLowerCase();
        });
    }

    /**
     * Ajusta los campos segun la configuracion del libro:
     * { amountFields: [IVA, Total], lineLevelFields: [Indicador, Nombre, Posicion] }.
     */
    function configure(mConfig) {
        if (mConfig && mConfig.amountFields) {
            AMOUNT_FIELDS = toLowerList(mConfig.amountFields);
        }
        if (mConfig && mConfig.lineLevelFields) {
            LINE_LEVEL_FIELDS = toLowerList(mConfig.lineLevelFields);
        }
    }

    /** Columna de importe: C01..C99, IVA o TOTAL. */
    function isAmountField(sField) {
        var sLower = String(sField || "").toLowerCase();
        return /^c\d+$/.test(sLower) || AMOUNT_FIELDS.indexOf(sLower) !== -1;
    }

    /**
     * Debe agruparse en el cliente cuando NINGUNA columna VISIBLE distingue
     * lineas de impuesto. Si el usuario agrego Indicador / Nombre / Pos.
     * impuestos, las filas del servidor ya son las que se quieren ver.
     */
    function needsGrouping(aVisibleFields) {
        return !(aVisibleFields || []).some(function (sField) {
            return LINE_LEVEL_FIELDS.indexOf(String(sField).toLowerCase()) !== -1;
        });
    }

    function normalizeKeyPart(vValue) {
        if (vValue === null || vValue === undefined) {
            return "";
        }
        if (vValue instanceof Date) {
            return "d" + vValue.getTime();
        }
        return String(vValue);
    }

    /**
     * Agrupa las filas por los campos de aGroupBy (los de importe se ignoran) y
     * suma los importes de aSelect. Conserva el orden de primera aparicion. Los importes se
     * suman en milesimas enteras (sin errores de coma flotante) y se
     * devuelven como texto con 3 decimales, igual que Edm.Decimal.
     */
    function groupRows(aRows, aSelect, aGroupBy) {
        var aAmountFields = aSelect.filter(isAmountField);
        var aDimFields = (aGroupBy || []).filter(function (sField) {
            return !isAmountField(sField);
        });
        var mGroups = {};
        var aGroups = [];

        (aRows || []).forEach(function (oRow) {
            var sGroupKey = aDimFields.map(function (sField) {
                return normalizeKeyPart(oRow[sField]);
            }).join("\u0001");
            var oGroup = mGroups[sGroupKey];
            if (!oGroup) {
                oGroup = { row: Object.assign({}, oRow), sums: {} };
                aAmountFields.forEach(function (sField) { oGroup.sums[sField] = 0; });
                mGroups[sGroupKey] = oGroup;
                aGroups.push(oGroup);
            }
            aAmountFields.forEach(function (sField) {
                var fValue = parseFloat(oRow[sField]);
                if (!isNaN(fValue)) {
                    oGroup.sums[sField] += Math.round(fValue * 1000);
                }
            });
        });

        return aGroups.map(function (oGroup) {
            aAmountFields.forEach(function (sField) {
                oGroup.row[sField] = (oGroup.sums[sField] / 1000).toFixed(3);
            });
            return oGroup.row;
        });
    }

    function compareValues(vA, vB, bAmount) {
        var bNullA = vA === null || vA === undefined || vA === "";
        var bNullB = vB === null || vB === undefined || vB === "";
        if (bNullA || bNullB) {
            if (bNullA === bNullB) {
                return 0;
            }
            return bNullA ? -1 : 1;
        }
        if (vA instanceof Date && vB instanceof Date) {
            return vA.getTime() - vB.getTime();
        }
        if (bAmount) {
            return parseFloat(vA) - parseFloat(vB);
        }
        var sA = String(vA);
        var sB = String(vB);
        if (sA === sB) {
            return 0;
        }
        return sA < sB ? -1 : 1;
    }

    /**
     * Ordena (estable) las filas ya agrupadas con los mismos criterios del
     * binding: aSorters = [{ path, descending }]. Sin criterios no cambia nada.
     */
    function sortRows(aRows, aSorters) {
        if (!aSorters || !aSorters.length) {
            return aRows;
        }
        return aRows.map(function (oRow, iIndex) {
            return { row: oRow, index: iIndex };
        }).sort(function (oA, oB) {
            for (var i = 0; i < aSorters.length; i++) {
                var oSorter = aSorters[i];
                var iResult = compareValues(oA.row[oSorter.path], oB.row[oSorter.path], isAmountField(oSorter.path));
                if (iResult !== 0) {
                    return oSorter.descending ? -iResult : iResult;
                }
            }
            return oA.index - oB.index;
        }).map(function (oItem) {
            return oItem.row;
        });
    }

    return {
        configure: configure,
        isAmountField: isAmountField,
        needsGrouping: needsGrouping,
        groupRows: groupRows,
        sortRows: sortRows
    };
});
