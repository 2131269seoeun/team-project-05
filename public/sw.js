// 웹 푸시를 받아 알림을 띄우는 서비스 워커
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* 본문이 없어도 기본 알림을 띄운다 */ }
  event.waitUntil(self.registration.showNotification(d.title || '법령 개정 알림', { body: d.body || '새 개정이 올라왔어요.', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});
