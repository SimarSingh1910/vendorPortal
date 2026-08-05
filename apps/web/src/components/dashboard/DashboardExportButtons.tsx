import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  exportClinicMonth,
  exportConsolidated,
  exportDashboardPdf,
  exportMonthEnd,
} from '@/api/export';
import type { DashboardFiltersState } from './useDashboardFilters';

/**
 * The dashboard export button group (Excel · Clinic month · Month-end · PDF),
 * shared by the finance and clinic (SPOC / cluster manager) dashboards.
 *
 * THE CLIENT DOES NOT DECIDE WHAT LANDS IN THE FILE. Each endpoint resolves its
 * rows through `ExportService`, which intersects with the caller's
 * `accessibleClinicIds` — so the very same "Excel" button yields every clinic for
 * finance and only their own for a SPOC or cluster manager, with no client-side
 * clinic list involved. Passing no clinic filter means "everything I'm allowed to
 * see", not "everything"; passing one the caller isn't entitled to is rejected
 * server-side with a 403 rather than silently widened or silently emptied.
 *
 * The MONTH-END report is offered to every role (Step 11.4). It is not an
 * org-wide-only artefact: `ExportService.monthEnd` already resolves "all ACTIVE
 * clinics" through the caller's `accessibleClinicIds`, so the same button gives
 * finance the whole org and a SPOC or cluster manager exactly their own clinics.
 * There is no clinic list on the wire for it at all — the button sends no
 * parameters, which is precisely why it cannot be widened from the client.
 */
export function DashboardExportButtons({
  filters,
}: {
  filters: DashboardFiltersState;
}) {
  const [exporting, setExporting] = useState<string | null>(null);

  async function runExport(key: string, fn: () => Promise<void>) {
    setExporting(key);
    try {
      await fn();
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!!exporting}
        onClick={() => runExport('consolidated', () => exportConsolidated(filters.exportFilter))}
      >
        <Download />
        {exporting === 'consolidated' ? 'Exporting…' : 'Excel'}
      </Button>
      {filters.soleClinicId && (
        <Button
          variant="outline"
          size="sm"
          disabled={!!exporting}
          onClick={() =>
            runExport('clinic', () => exportClinicMonth(filters.soleClinicId!, filters.asOf))
          }
        >
          <Download />
          {exporting === 'clinic' ? 'Exporting…' : 'Clinic month'}
        </Button>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!!exporting}
        onClick={() => runExport('month-end', () => exportMonthEnd())}
      >
        <Download />
        {exporting === 'month-end' ? 'Exporting…' : 'Month-end report'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!!exporting}
        onClick={() => runExport('pdf', () => exportDashboardPdf(filters.exportFilter))}
      >
        <FileText />
        {exporting === 'pdf' ? 'Generating…' : 'PDF'}
      </Button>
    </div>
  );
}
