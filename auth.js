// auth.js - Защита с хэшированием паролей и контактами
class PasswordProtector {
    constructor() {
        // ЗДЕСЬ ВСТАВЬТЕ ХЭШИ ОТ ВАШИХ ПАРОЛЕЙ
        this.validHashes = [
            "feb03acb486be9907ed2c13fe02e048989c618f889ef156c5f24f1cadc37d554", // Лена
            "b13c26fc7f4391d43fe885c3c1a88549f833989c0f966091cb806ae55318cb58", // Настя
            "33fe23df3a3e0a1e635e479d93a6148a735cbdb6de2673b37569e7d5eba18e32"  // Радмила
            "af02d5d2f3640121df2a5c54a392388ebaadf0805aef92cff3b3ff25fed96b06", // Сергей
            "a31e652286378affe73d4a5d5fd3909de433c19c4e642d44bdcb979b65897845", // Виталик
            "ab7cfc9c5cf5f7e07d1e31395e4e0099e749a273ec4bffedade989eafc02ff27"  // Ирина
            "af02d5d2f3640121df2a5c54a392388ebaadf0805aef92cff3b3ff25fed96b06", // Татьяна
            
        ];
        
        this.checkAuthentication();
    }
    
    async checkAuthentication() {
        // Проверяем, есть ли активная сессия
        const sessionAuth = sessionStorage.getItem('fohowAuth');
        if (sessionAuth === 'authenticated') {
            return; // Пользователь уже авторизован
        }
        
        // Запрашиваем пароль
        await this.requestPassword();
    }
    
    async requestPassword() {
        const password = prompt("🔐 Введите пароль для доступа к FOHOW проекту:");
        
        if (!password) {
            this.showAccessDenied("Пароль не введен");
            return;
        }
        
        // Создаем хэш от введенного пароля
        const inputHash = await this.sha256(password);
        
        // Проверяем, есть ли такой хэш в списке разрешенных
        if (this.validHashes.includes(inputHash)) {
            // Пароль верный - сохраняем сессию
            sessionStorage.setItem('fohowAuth', 'authenticated');
        } else {
            // Неверный пароль
            this.showAccessDenied("Неверный пароль");
        }
    }
    
    // Функция для создания хэша SHA-256
    async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    showAccessDenied(reason) {
        // Полностью заменяем содержимое страницы
        document.body.innerHTML = this.getAccessDeniedPage(reason);
        
        // Блокируем любые другие скрипты
        throw new Error("Access denied: " + reason);
    }
    
    getAccessDeniedPage(reason) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Доступ ограничен - FOHOW Project</title>
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        font-family: 'Arial', sans-serif;
                    }
                    .denied-container {
                        text-align: center;
                        background: white;
                        padding: 50px;
                        border-radius: 20px;
                        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
                        max-width: 500px;
                    }
                    .lock-icon {
                        font-size: 80px;
                        margin-bottom: 20px;
                    }
                    h1 {
                        color: #ff4757;
                        margin-bottom: 20px;
                    }
                    .telegram-section {
                        background: linear-gradient(135deg, #0088cc, #00a2ff);
                        color: white;
                        padding: 20px;
                        border-radius: 10px;
                        margin: 20px 0;
                    }
                    .tg-icon {
                        font-size: 24px;
                        margin-right: 10px;
                    }
                    .contact-button {
                        display: inline-flex;
                        align-items: center;
                        background: white;
                        color: #0088cc;
                        padding: 12px 25px;
                        border-radius: 8px;
                        text-decoration: none;
                        font-weight: bold;
                        margin-top: 15px;
                        transition: transform 0.2s;
                    }
                    .contact-button:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                    }
                    .refresh-hint {
                        margin-top: 20px;
                        font-size: 12px;
                        color: #666;
                    }
                </style>
            </head>
            <body>
                <div class="denied-container">
                    <div class="lock-icon">🔒</div>
                    <h1>Доступ к FOHOW Project</h1>
                    
                    <p><strong>Статус:</strong> ${reason}</p>
                    <p>Проект доступен только по паролю для авторизованных пользователей</p>
                    
                    <div class="telegram-section">
                        <h3>🚀 Получить доступ</h3>
                        <p>Свяжитесь с администратором в Telegram:</p>
                        
                        <a href="https://t.me/MarketingFohow" target="_blank" class="contact-button">
                            <span class="tg-icon">✈️</span>
                            Написать @MarketingFohow
                        </a>
                        
                        <div style="margin-top: 15px; font-size: 13px;">
                            📋 <em>Укажите в сообщении: "Запрос доступа к FOHOW проекту"</em>
                        </div>
                    </div>
                    
                    <div class="refresh-hint">
                        🔄 <strong>Обновите страницу (F5)</strong> для ввода пароля
                    </div>
                </div>
            </body>
            </html>
        `;
    }
}

// Запускаем защиту при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    new PasswordProtector();

});
