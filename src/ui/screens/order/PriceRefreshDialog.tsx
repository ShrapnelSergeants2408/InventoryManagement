// "Price refresh steps" from the stale-price banner (F14, SPEC §10).
import { Dialog, DialogActions } from '../../components/Dialog';

export function PriceRefreshDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="Price refresh steps" onClose={onClose}>
      <h2 class="h2">Refreshing prices</h2>
      <p class="dlg-p">The app can’t read vendor websites itself, so prices are refreshed with Claude before an order:</p>
      <ol class="steps">
        <li>
          <strong>Export a data-only backup</strong> (More › Backup &amp; restore › Data only).
        </li>
        <li>
          In a desktop chat with web search, give the file to <strong>Claude</strong> and ask it to check current prices for the items on the order list. It returns a
          price-update CSV.
        </li>
        <li>
          <strong>Import the price update</strong> (More › Backup &amp; restore › Price update import, mentor PIN). It changes only prices, pack sizes, links and “price checked”, never
          counts.
        </li>
      </ol>
      <p class="dlg-p small muted">McMaster-Carr shows prices only when signed in, so its options are checked by a mentor. Each order line’s supplier link opens the product page to check one price by hand.</p>
      <DialogActions>
        <button type="button" class="btn pri lg" data-autofocus onClick={onClose}>
          OK
        </button>
      </DialogActions>
    </Dialog>
  );
}
