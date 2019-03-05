describe('dev-server', () => {
  it('shows the contents of static assets', async () => {
    await page.goto('http://localhost:3200');

    const list = await page.$$eval('#files li .name', spans => {
      return spans.map(span => span.textContent);
    });

    expect(list).toEqual(
      expect.arrayContaining(['app.bundle.js', 'media', 'assets']),
    );
  });

  it('shows the contents of assets dir', async () => {
    await page.goto('http://localhost:3200/assets');

    const list = await page.$$eval('#files li .name', spans => {
      return spans.map(span => span.textContent);
    });

    expect(list).toContain('hello.txt');
  });
});
