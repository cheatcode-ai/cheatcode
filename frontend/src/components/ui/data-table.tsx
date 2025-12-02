'use client';

import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  width?: string;
}

export interface DataTableProps<T extends { id?: string | number }> {
  columns: DataTableColumn<T>[];
  data: T[];
  className?: string;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  /** Function to get unique key for each row. Defaults to item.id or index */
  getRowKey?: (item: T, index: number) => string | number;
}

/** Memoized table row component to prevent unnecessary re-renders */
const MemoizedTableRow = React.memo(function MemoizedTableRow<T>({
  item,
  columns,
  onRowClick,
}: {
  item: T;
  columns: DataTableColumn<T>[];
  onRowClick?: (item: T) => void;
}) {
  return (
    <TableRow
      className={cn(
        onRowClick && 'cursor-pointer hover:bg-muted/50',
      )}
      onClick={() => onRowClick?.(item)}
    >
      {columns.map((column) => (
        <TableCell
          key={column.id}
          className={cn(column.className, column.width)}
        >
          {column.cell
            ? column.cell(item)
            : column.accessorKey
              ? String(item[column.accessorKey] || '')
              : ''
          }
        </TableCell>
      ))}
    </TableRow>
  );
}) as <T>(props: {
  item: T;
  columns: DataTableColumn<T>[];
  onRowClick?: (item: T) => void;
}) => React.ReactElement;

export function DataTable<T extends { id?: string | number }>({
  columns,
  data,
  className,
  emptyMessage = 'No data available',
  onRowClick,
  getRowKey,
}: DataTableProps<T>) {
  // Memoize the key getter function
  const getKey = React.useCallback((item: T, index: number): string | number => {
    if (getRowKey) return getRowKey(item, index);
    if (item.id !== undefined) return item.id;
    return index;
  }, [getRowKey]);

  return (
    <div className={cn('rounded-md border', className)}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.id}
                className={cn(column.headerClassName, column.width, 'text-muted-foreground font-semibold')}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((item, index) => (
              <MemoizedTableRow
                key={getKey(item, index)}
                item={item}
                columns={columns}
                onRowClick={onRowClick}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
} 