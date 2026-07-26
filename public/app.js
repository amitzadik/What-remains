document.getElementById('search-button').addEventListener('click', async () => {
  const archiveCode = document.getElementById('code-input').value.trim();
  const userQuery = document.getElementById('query-input').value.trim();
  const displayElement = document.getElementById('archive-display');
  const statusElement = document.getElementById('status-message');

  if (!archiveCode || !userQuery) {
    alert("נא להזין קוד ארכיון ושאילתת אחזור.");
    return;
  }

  displayElement.innerText = "מבצע אחזור מתוך הארכיון...";
  statusElement.innerText = "";

  try {
    const response = await fetch('/api/archive/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveCode, query: userQuery })
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || "אירעה שגיאה באחזור הארכיון.");
    }

    const data = await response.json();

    // 1. Display on-screen excerpt
    displayElement.innerText = data.onscreen_response;

    // 2. Populate print template placeholders
    document.getElementById('print-summary-placeholder').innerText = data.print_payload.summary;

    const imgContainer = document.getElementById('print-images-placeholder');
    imgContainer.innerHTML = '';

    if (data.print_payload.images && data.print_payload.images.length > 0) {
      data.print_payload.images.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        imgContainer.appendChild(img);
      });
    }

    // 3. Populate status message
    statusElement.innerText = data.print_status_message;

    // 4. Trigger print process
    setTimeout(() => {
      window.print();
    }, 500);

  } catch (err) {
    console.error(err);
    displayElement.innerText = "שגיאת מערכת: לא ניתן להשלים את הליך האחזור.";
    statusElement.innerText = err.message;
  }
});