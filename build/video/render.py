from playwright.sync_api import sync_playwright
FPS=30
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1080,'height':1920})
    pg.goto('file:///home/claude/video/tutorial.html'); pg.wait_for_timeout(1000)
    total=pg.evaluate('TOTAL'); n=int(total*FPS)
    for i in range(n):
        pg.evaluate(f'render({i/FPS})')
        pg.screenshot(path=f'frames/f{i:05d}.jpg',type='jpeg',quality=88)
    b.close()
print('frames',n)
