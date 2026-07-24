import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function DataTable({
  columns,
  data = [],
  isLoading,
  loading,
  actions,
  onRowClick,
  emptyMessage = "Aucune donnée",
}) {
  const effectiveLoading = isLoading ?? loading ?? false;
  const rows = Array.isArray(data) ? data : [];

  const allColumns = actions
    ? [...columns, { key: "__actions", label: "Actions", sortable: false }]
    : columns;

  if (effectiveLoading) {
    return (
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                {allColumns.map((col) => (
                  <TableHead key={col.key} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  {allColumns.map((col) => (
                    <TableCell key={col.key}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Scroll horizontal sur mobile — les tableaux ne débordent jamais */}
      <div className="overflow-x-auto">
        <Table className="min-w-full">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {allColumns.map((col) => (
                <TableHead key={col.key} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow
                  key={row.id || i}
                  className={onRowClick ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                  onClick={() => onRowClick?.(row)}
                >
                  {allColumns.map((col) => {
                    if (col.key === "__actions") {
                      return (
                        <TableCell key={col.key} className="text-sm whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {actions(row)}
                        </TableCell>
                      );
                    }
                    const value = row[col.key];
                    return (
                      <TableCell key={col.key} className="text-sm whitespace-nowrap">
                        {col.render ? col.render(value, row) : (value ?? "—")}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
