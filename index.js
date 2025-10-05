// Supabase configuration
const SUPABASE_URL = 'https://cxjftikjoskdeakoxhgr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amZ0aWtqb3NrZGVha294aGdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1MDA1OTgsImV4cCI6MjA3NTA3NjU5OH0.CS2iXOABcX4QPY472eXW8MkxoQJXDiC_WzKWPhFtISY';

class IMENDITransApp {
    constructor() {
        this.currentUser = null;
        this.currentView = 'dashboard';
        this.pageOrder = ['dashboard', 'new-bon', 'history', 'stats', 'settings'];
        this.offlineMode = !navigator.onLine;
        this.db = null;
        this.lastGeneratedNumber = 0; // Tracks the last number used in this session
        
        this.init();
    }

    async init() {
        await this.initDatabase();
        this.setupEventListeners();
        await this.checkAuthStatus();
        this.registerServiceWorker();
        this.updateOfflineBanner();
    }

    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('IMENDITrans', 1);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('sync-queue')) {
                    const store = db.createObjectStore('sync-queue', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('type', 'type');
                    store.createIndex('timestamp', 'timestamp');
                }
            };
        });
    }

    setupEventListeners() {
        // Auth events
        document.getElementById('login-tab').addEventListener('click', () => this.switchAuthTab('login'));
        document.getElementById('register-tab').addEventListener('click', () => this.switchAuthTab('register'));
        document.getElementById('login-submit').addEventListener('click', (e) => this.handleLogin(e));
        document.getElementById('register-submit').addEventListener('click', (e) => this.handleRegister(e));

        // Navigation events
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => this.handleNavigation(e));
        });

        // Mobile menu
        document.getElementById('mobile-menu-btn').addEventListener('click', () => this.toggleMobileMenu());
        document.getElementById('logout-mobile-btn').addEventListener('click', () => this.handleLogout());
        document.getElementById('menu-overlay').addEventListener('click', () => this.closeMobileMenu());

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        // New Bon events
        document.getElementById('add-luggage').addEventListener('click', () => this.addLuggageItem());
        document.getElementById('cancel-bon').addEventListener('click', () => this.cancelBon());
        document.getElementById('quick-create-bon').addEventListener('click', () => this.navigateTo('new-bon'));

        // History events
        document.getElementById('search-input').addEventListener('input', (e) => this.searchBons(e.target.value));

        // Statistics events
        document.getElementById('apply-filters').addEventListener('click', () => this.loadStatistics());

        // Settings events
        document.getElementById('save-username').addEventListener('click', () => this.saveUsername());

        // Form submission
        document.getElementById('bon-form').addEventListener('submit', (e) => this.handleSubmitBon(e));

        // Online/Offline detection
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Remove luggage items
        document.getElementById('luggage-container').addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-luggage')) {
                const container = document.getElementById('luggage-container');
                if (container.children.length > 1) {
                    e.target.parentElement.remove();
                    this.updateTotalColis();
                }
            }
        });

        // Update total colis when luggage items change
        document.getElementById('luggage-container').addEventListener('input', (e) => {
            if (e.target.classList.contains('luggage-quantity')) {
                this.updateTotalColis();
            }
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered');
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    switchAuthTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach(form => form.classList.add('hidden'));
        
        if (tab === 'login') {
            document.getElementById('login-tab').classList.add('active');
            document.getElementById('login-form').classList.remove('hidden');
        } else {
            document.getElementById('register-tab').classList.add('active');
            document.getElementById('register-form').classList.remove('hidden');
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const messageEl = document.getElementById('login-message');

        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                this.currentUser = data.user;
                await this.initializeLastGeneratedNumber();
                this.showPage('main-app');
                this.navigateTo('dashboard');
                await this.loadDashboard();
            } else {
                messageEl.textContent = data.error_description || 'Identifiants incorrects';
                messageEl.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Login error:', error);
            messageEl.textContent = 'Erreur de connexion';
            messageEl.classList.remove('hidden');
        }
    }

    async handleRegister(event) {
        event.preventDefault();
        
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const username = document.getElementById('register-username').value.trim();
        const messageEl = document.getElementById('register-message');

        if (password !== confirmPassword) {
            messageEl.textContent = 'Les mots de passe ne correspondent pas';
            messageEl.classList.remove('hidden');
            return;
        }

        if (!username) {
            messageEl.textContent = 'Veuillez entrer un nom d\'utilisateur';
            messageEl.classList.remove('hidden');
            return;
        }

        try {
            // First, create the user
            const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                // After successful registration, create profile with username
                await this.createProfile(data.user.id, username);
                
                messageEl.textContent = 'Compte créé avec succès !';
                messageEl.className = 'message success';
                messageEl.classList.remove('hidden');
                
                // Auto-switch to login after 2 seconds
                setTimeout(() => {
                    this.switchAuthTab('login');
                    document.getElementById('login-email').value = email;
                    document.getElementById('register-email').value = '';
                    document.getElementById('register-password').value = '';
                    document.getElementById('register-confirm-password').value = '';
                    document.getElementById('register-username').value = '';
                    messageEl.classList.add('hidden');
                    messageEl.className = 'message hidden';
                }, 2000);
            } else {
                messageEl.textContent = data.error_description || 'Erreur lors de l\'inscription';
                messageEl.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Registration error:', error);
            messageEl.textContent = 'Erreur de connexion';
            messageEl.classList.remove('hidden');
        }
    }

    async createProfile(userId, username) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify({ 
                    id: userId,
                    username: username,
                    full_name: username
                })
            });
            
            if (response.ok) {
                console.log('Profile created successfully');
            }
        } catch (error) {
            console.error('Error creating profile:', error);
        }
    }

    async checkAuthStatus() {
        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (response.ok) {
                    this.currentUser = await response.json();
                    await this.initializeLastGeneratedNumber();
                    this.showPage('main-app');
                    await this.loadDashboard();
                } else {
                    this.showPage('auth-page');
                }
            } catch (error) {
                console.error('Auth check error:', error);
                this.showPage('auth-page');
            }
        } else {
            this.showPage('auth-page');
        }
    }

    handleNavigation(event) {
        event.preventDefault();
        const target = event.target.getAttribute('href').substring(1);
        this.navigateTo(target);
    }

    navigateTo(view) {
        if (this.currentView === view) return;
    
        const oldView = this.currentView;
        const oldIndex = this.pageOrder.indexOf(oldView);
        const newIndex = this.pageOrder.indexOf(view);
    
        const currentPage = document.getElementById(`${oldView}-page`);
        const nextPage = document.getElementById(`${view}-page`);
    
        if (!currentPage || !nextPage) return;
    
        const mainContent = document.querySelector('.main-content');
        mainContent.style.overflow = 'hidden';
    
        let oldPageAnimation, newPageAnimation;
        if (newIndex > oldIndex) {
            oldPageAnimation = 'page-slide-out-to-left';
            newPageAnimation = 'page-slide-in-from-right';
        } else {
            oldPageAnimation = 'page-slide-out-to-right';
            newPageAnimation = 'page-slide-in-from-left';
        }
    
        currentPage.classList.add('page-transition', oldPageAnimation);
        nextPage.classList.remove('hidden');
        nextPage.classList.add('page-transition', newPageAnimation);
    
        // Update navigation active state
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${view}`) {
                link.classList.add('active');
            }
        });
    
        this.currentView = view;
        localStorage.setItem('currentView', view);
    
        // Load content for the new view
        switch (view) {
            case 'dashboard': this.loadDashboard(); break;
            case 'new-bon': this.loadNewBon(); break;
            case 'history': this.loadHistory(); break;
            case 'stats': this.loadStatistics(); break;
            case 'settings': this.loadSettings(); break;
        }
    
        // Clean up animation classes
        setTimeout(() => {
            currentPage.classList.add('hidden');
            currentPage.classList.remove('page-transition', oldPageAnimation);
            nextPage.classList.remove('page-transition', newPageAnimation);
            mainContent.style.overflow = '';
        }, 400); // Must match animation duration
    
        this.closeMobileMenu();
    }
    
    toggleMobileMenu() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        const overlay = document.getElementById('menu-overlay');
        const isOpen = menu.classList.contains('open');
    
        menuBtn.classList.toggle('open', !isOpen);
        menu.classList.toggle('open', !isOpen);
        overlay.classList.toggle('open', !isOpen);
        menuBtn.setAttribute('aria-expanded', String(!isOpen));
        
        document.body.style.overflow = !isOpen ? 'hidden' : '';
    }
    
    closeMobileMenu() {
        const menuBtn = document.getElementById('mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        const overlay = document.getElementById('menu-overlay');
        
        if (menu.classList.contains('open')) {
            menuBtn.classList.remove('open');
            menu.classList.remove('open');
            overlay.classList.remove('open');
            menuBtn.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = '';
        }
    }

    async handleLogout() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('currentView');
        this.currentUser = null;
        this.showPage('auth-page');
    }

    showPage(pageId) {
        document.querySelectorAll('#app > div').forEach(div => {
            div.classList.add('hidden');
        });
        document.getElementById(pageId).classList.remove('hidden');
    }

    addLuggageItem() {
        const container = document.getElementById('luggage-container');
        const item = document.createElement('div');
        item.className = 'luggage-item';
        item.innerHTML = `
            <input type="text" class="luggage-type" placeholder="Type d'article" required>
            <input type="number" class="luggage-quantity" placeholder="Quantité" min="1" required>
            <button type="button" class="remove-luggage btn btn-danger">Supprimer</button>
        `;
        container.appendChild(item);
        
        // Add event listener for quantity input
        item.querySelector('.luggage-quantity').addEventListener('input', () => {
            this.updateTotalColis();
        });
        
        this.updateTotalColis();
    }

    updateTotalColis() {
        let total = 0;
        document.querySelectorAll('.luggage-quantity').forEach(input => {
            const value = parseInt(input.value) || 0;
            total += value;
        });
        document.getElementById('total-colis').textContent = total;
    }

    async handleSubmitBon(event) {
        event.preventDefault();
        
        const formData = this.getFormData();
        const displayedId = formData.id;
        let finalId = displayedId;
        
        // Online check: Re-fetch the absolute latest ID from the database to prevent race conditions
        if (!this.offlineMode) {
            const year = new Date().getFullYear();
            let lastNumberFromDB = 0;
            try {
                const token = localStorage.getItem('access_token');
                const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=like.BON-${year}-*&order=id.desc&limit=1`, {
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error('Failed to verify last bon number.');
                
                const result = await response.json();
                if (result.length > 0) {
                    lastNumberFromDB = parseInt(result[0].id.split('-')[2]);
                }
            } catch (error) {
                console.error("Could not verify last bon number from DB.", error);
                this.showMessage('Erreur réseau, impossible de vérifier le numéro du bon. Réessayez.', 'error');
                return; // Stop submission
            }

            const displayedNumber = parseInt(displayedId.split('-')[2]);
            const expectedNextNumber = lastNumberFromDB > 0 ? lastNumberFromDB + 1 : 1000;

            if (displayedNumber < expectedNextNumber) {
                const newId = `BON-${year}-${expectedNextNumber.toString().padStart(4, '0')}`;
                const userConfirmed = confirm(
                    `Le numéro du bon a changé car un autre a été créé. Le nouveau numéro est : ${newId}.\n\nVoulez-vous enregistrer avec ce nouveau numéro ?`
                );
                
                if (userConfirmed) {
                    finalId = newId;
                } else {
                    await this.prepareNextBonId(); // Refresh UI with the correct next number
                    return; // Cancel the save
                }
            }
        }
        
        formData.id = finalId;
        const finalNumber = parseInt(finalId.split('-')[2]);

        try {
            let saved = false;
            if (this.offlineMode) {
                await this.storeOffline(formData);
                saved = true;
                this.showMessage('Bon sauvegardé localement. Synchronisation automatique...', 'success');
            } else {
                const result = await this.submitToSupabase(formData);
                if (result) {
                    saved = true;
                    this.showMessage('Bon enregistré avec succès !', 'success');
                } else {
                    // Assume network failure, save offline
                    await this.storeOffline(formData);
                    saved = true;
                    this.showMessage('Erreur réseau. Sauvegardé localement...', 'warning');
                }
            }
            
            if (saved) {
                // Only now do we "consume" the number by updating our local counters
                this.lastGeneratedNumber = Math.max(this.lastGeneratedNumber, finalNumber);
                localStorage.setItem('lastGeneratedNumber', this.lastGeneratedNumber.toString());
                this.navigateTo('history');
            }

        } catch (error) {
            console.error('Error submitting bon:', error);
            this.showMessage(`Erreur lors de l'enregistrement: ${error.message}`, 'error');
        }
    }


    getFormData() {
        const luggage = [];
        document.querySelectorAll('.luggage-item').forEach(item => {
            const type = item.querySelector('.luggage-type').value;
            const quantity = parseInt(item.querySelector('.luggage-quantity').value);
            if (type && quantity) {
                luggage.push({ type, quantity });
            }
        });

        return {
            id: document.getElementById('bon-id').value || document.getElementById('current-bon-id').textContent,
            sender_first_name: document.getElementById('sender-first-name').value,
            sender_last_name: document.getElementById('sender-last-name').value,
            sender_phone: document.getElementById('sender-phone').value,
            sender_cin: document.getElementById('sender-cin').value,
            recipient_first_name: document.getElementById('recipient-first-name').value,
            recipient_last_name: document.getElementById('recipient-last-name').value,
            recipient_phone: document.getElementById('recipient-phone').value,
            recipient_cin: document.getElementById('recipient-cin').value,
            origin: document.getElementById('origin').value,
            destination: document.getElementById('destination').value,
            luggage: luggage,
            total: parseFloat(document.getElementById('total').value),
            paid: document.getElementById('paid').checked,
            user_id: this.currentUser.id
        };
    }

    async initializeLastGeneratedNumber() {
        const year = new Date().getFullYear();
        let lastKnownNumber = 0;

        // 1. Get from localStorage (covers offline work across sessions)
        const localLastNumber = parseInt(localStorage.getItem('lastGeneratedNumber') || '0');
        lastKnownNumber = localLastNumber;

        // 2. Try to get the most recent number from Supabase if online (across all users)
        if (!this.offlineMode && this.currentUser) {
            try {
                const token = localStorage.getItem('access_token');
                // Query for the absolute latest bon number in the current year
                const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=like.BON-${year}-*&order=id.desc&limit=1`, {
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.length > 0) {
                        const lastId = result[0].id;
                        const lastNumberFromDB = parseInt(lastId.split('-')[2]);
                        // Use the highest number between local and DB
                        lastKnownNumber = Math.max(lastKnownNumber, lastNumberFromDB);
                    }
                }
            } catch (error) {
                console.error("Could not fetch last bon number from DB, relying on local value.", error);
            }
        }
        
        this.lastGeneratedNumber = lastKnownNumber;
        console.log(`Initialized lastGeneratedNumber to: ${this.lastGeneratedNumber}`);
    }

    async prepareNextBonId() {
        const year = new Date().getFullYear();
        const prefix = `BON-${year}-`;
        const defaultStartNumber = 1000;
        
        let lastNumberFromDB = 0;
        if (!this.offlineMode) {
            try {
                const token = localStorage.getItem('access_token');
                // Query for the absolute latest bon number in the current year
                const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=like.BON-${year}-*&order=id.desc&limit=1`, {
                    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.length > 0) {
                        lastNumberFromDB = parseInt(result[0].id.split('-')[2]);
                    }
                }
            } catch (error) {
                console.warn('Could not fetch last bon number from DB for display. Falling back to local.', error);
            }
        }
        
        const lastNumberFromLocal = parseInt(localStorage.getItem('lastGeneratedNumber') || '0');
        const baseNumber = Math.max(lastNumberFromDB, lastNumberFromLocal, this.lastGeneratedNumber);
        const nextNum = Math.max(baseNumber + 1, defaultStartNumber);
        
        const id = `${prefix}${nextNum.toString().padStart(4, '0')}`;
        
        // Display it, but do not consume it
        document.getElementById('current-bon-id').textContent = id;
        document.getElementById('bon-id').value = id;
    }

    async submitToSupabase(data) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`,
                    'Prefer': 'return=representation'
                },
                body: JSON.stringify(data)
            });

            return response.ok;
        } catch (error) {
            console.error('Supabase error:', error);
            return false;
        }
    }

    async storeOffline(data) {
        const transaction = this.db.transaction(['sync-queue'], 'readwrite');
        const store = transaction.objectStore('sync-queue');
        
        await store.add({
            type: 'bon',
            data,
            timestamp: Date.now()
        });

        // Register sync
        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('sync-bons');
        }
    }

    cancelBon() {
        this.navigateTo('history');
    }

    async loadDashboard() {
        // Load username from profiles table
        const username = await this.getUsernameFromProfile();
        document.getElementById('user-name').textContent = username || this.currentUser.email;
        
        // Load recent bons
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}&order=created_at.desc&limit=3`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                const container = document.getElementById('recent-bons');
                
                if (bons.length === 0) {
                    container.innerHTML = '<p>Aucun bon récent</p>';
                } else {
                    container.innerHTML = bons.map(bon => `
                        <div class="recent-bon">
                            <strong>${bon.id}</strong><br>
                            <small>${bon.origin} → ${bon.destination}</small><br>
                            <small>${bon.sender_first_name} ${bon.sender_last_name}</small>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Error loading dashboard:', error);
        }
    }

    async loadNewBon(bon = null) {
        // Reset form
        document.getElementById('bon-form').reset();
        document.getElementById('bon-id').value = '';
        document.getElementById('paid').checked = false;

        // Clear luggage items except first one
        const container = document.getElementById('luggage-container');
        while (container.children.length > 1) {
            container.removeChild(container.lastChild);
        }

        if (bon) {
            // Editing existing bon
            document.getElementById('bon-form-title').textContent = 'Modifier le Bon';
            document.getElementById('current-bon-id').textContent = bon.id;
            document.getElementById('bon-id').value = bon.id;
            document.getElementById('sender-first-name').value = bon.sender_first_name;
            document.getElementById('sender-last-name').value = bon.sender_last_name;
            document.getElementById('sender-phone').value = bon.sender_phone;
            document.getElementById('sender-cin').value = bon.sender_cin;
            document.getElementById('recipient-first-name').value = bon.recipient_first_name;
            document.getElementById('recipient-last-name').value = bon.recipient_last_name;
            document.getElementById('recipient-phone').value = bon.recipient_phone;
            document.getElementById('recipient-cin').value = bon.recipient_cin;
            document.getElementById('origin').value = bon.origin;
            document.getElementById('destination').value = bon.destination;
            document.getElementById('total').value = bon.total;
            document.getElementById('paid').checked = bon.paid;

            // Load luggage items
            const firstItem = container.querySelector('.luggage-item');
            if (firstItem) {
                const luggage = bon.luggage;
                if (luggage && luggage.length > 0) {
                    firstItem.querySelector('.luggage-type').value = luggage[0].type;
                    firstItem.querySelector('.luggage-quantity').value = luggage[0].quantity;
                    
                    for (let i = 1; i < luggage.length; i++) {
                        this.addLuggageItem();
                        const newItem = container.lastChild;
                        newItem.querySelector('.luggage-type').value = luggage[i].type;
                        newItem.querySelector('.luggage-quantity').value = luggage[i].quantity;
                    }
                }
            }
        } else {
            // Creating new bon - show the potential next ID without consuming it
            document.getElementById('bon-form-title').textContent = 'Nouveau Bon';
            await this.prepareNextBonId();
        }

        // Update total colis
        this.updateTotalColis();
    }

    async loadHistory() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}&order=created_at.desc`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                this.displayHistory(bons);
            }
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    displayHistory(bons) {
        const tbody = document.getElementById('history-table-body');
        tbody.innerHTML = '';

        bons.forEach(bon => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${bon.id}</td>
                <td>${bon.sender_first_name} ${bon.sender_last_name}</td>
                <td>${bon.recipient_first_name} ${bon.recipient_last_name}</td>
                <td>${bon.origin}</td>
                <td>${bon.destination}</td>
                <td>${new Date(bon.created_at).toLocaleDateString()}</td>
                <td>${bon.total} €</td>
                <td>${bon.paid ? 'Oui' : 'Non'}</td>
                <td>
                    <button class="btn btn-secondary btn-small edit-btn" data-id="${bon.id}">Modifier</button>
                    <button class="btn btn-info btn-small share-btn" data-id="${bon.id}">Partager</button>
                    <button class="btn btn-success btn-small export-btn" data-id="${bon.id}">PDF</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add event listeners to action buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.editBon(id);
            });
        });

        document.querySelectorAll('.share-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.shareBon(id);
            });
        });

        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.dataset.id;
                this.exportPDF(id);
            });
        });
    }

    async editBon(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bon = await response.json();
                this.navigateTo('new-bon');
                this.loadNewBon(bon[0]);
            }
        } catch (error) {
            console.error('Error loading bon for edit:', error);
        }
    }

    async shareBon(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bon = await response.json();
                
                // Create a temporary element to generate the content
                const tempDiv = document.createElement('div');
                tempDiv.style.display = 'none';
                tempDiv.innerHTML = `
                    <div style="padding: 20px; font-family: Arial, sans-serif;">
                        <h2>Bon d'expédition</h2>
                        <p><strong>ID:</strong> ${bon[0].id}</p>
                        <p><strong>Date:</strong> ${new Date(bon[0].created_at).toLocaleDateString()}</p>
                        <h3>Expéditeur:</h3>
                        <p>${bon[0].sender_first_name} ${bon[0].sender_last_name}</p>
                        <p>Téléphone: ${bon[0].sender_phone}</p>
                        <p>CIN: ${bon[0].sender_cin}</p>
                        <h3>Destinataire:</h3>
                        <p>${bon[0].recipient_first_name} ${bon[0].recipient_last_name}</p>
                        <p>Téléphone: ${bon[0].recipient_phone}</p>
                        <p>CIN: ${bon[0].recipient_cin}</p>
                        <h3>Itinéraire:</h3>
                        <p>${bon[0].origin} → ${bon[0].destination}</p>
                        <h3>Bagages:</h3>
                        ${bon[0].luggage.map(item => `<p>${item.type}: ${item.quantity}</p>`).join('')}
                        <p><strong>Total des colis:</strong> ${bon[0].luggage.reduce((total, item) => total + item.quantity, 0)}</p>
                        <p><strong>Total:</strong> ${bon[0].total} €</p>
                        <p><strong>Payé:</strong> ${bon[0].paid ? 'Oui' : 'Non'}</p>
                    </div>
                `;
                document.body.appendChild(tempDiv);
                
                const canvas = await html2canvas(tempDiv);
                const image = canvas.toDataURL('image/png');
                
                // Create blob from data URL
                const byteString = atob(image.split(',')[1]);
                const mimeString = image.split(',')[0].split(':')[1].split(';')[0];
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                    ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: mimeString });
                
                if (navigator.share) {
                    await navigator.share({
                        title: `Bon d'expédition ${bon[0].id}`,
                        text: `Bon d'expédition pour ${bon[0].recipient_first_name} ${bon[0].recipient_last_name}`,
                        files: [new File([blob], 'bon.png', { type: 'image/png' })]
                    });
                } else {
                    // Fallback: download image
                    const link = document.createElement('a');
                    link.href = image;
                    link.download = `bon_${id}.png`;
                    link.click();
                }
                
                // Clean up
                document.body.removeChild(tempDiv);
            }
        } catch (error) {
            console.error('Error sharing bon:', error);
        }
    }

    sanitizeForPDF(text) {
        if (!text) return '';
        // Keeps letters (including common accented ones), numbers, spaces, and basic punctuation.
        // Removes other symbols that might not be supported by the PDF font.
        return text.toString().replace(/[^A-Za-z0-9_\s\-.,\u00C0-\u017F]/g, '');
    }

    async exportPDF(id) {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/bons?id=eq.${id}&user_id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });
    
            if (!response.ok) throw new Error('Failed to fetch bon data.');
    
            const bonData = await response.json();
            const bon = bonData[0];
            if (!bon) throw new Error('Bon not found.');
    
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    
            // Fetch and add logo
            try {
                const imgResponse = await fetch('images/image300v2.png');
                const blob = await imgResponse.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                // Adjust width and height as needed, maintaining aspect ratio. 
                // Assuming original is 300x100, let's use 45x15mm.
                doc.addImage(dataUrl, 'PNG', 20, 15, 45, 15);
            } catch (e) {
                console.error("Could not add logo to PDF:", e);
                // Fallback to text if logo fails
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(16);
                doc.text('IMENDI TRANS', 20, 20);
            }
    
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
    
            doc.setFontSize(12);
            doc.text(bon.id, 150, 20);
            doc.setFontSize(10);
            doc.text(`Date: ${new Date(bon.created_at).toLocaleDateString('fr-FR')}`, 150, 25);
    
            doc.setDrawColor(30, 58, 138);
            doc.line(20, 35, 190, 35); // Adjusted Y position
    
            // Sender & Recipient details
            let yPos = 45;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(30, 58, 138);
            doc.text('Expéditeur', 25, yPos);
            doc.text('Destinataire', 110, yPos);
    
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.text(`Nom: ${bon.sender_first_name} ${bon.sender_last_name}`, 25, yPos + 5);
            doc.text(`Téléphone: ${bon.sender_phone}`, 25, yPos + 10);
            doc.text(`CIN: ${bon.sender_cin}`, 25, yPos + 15);
    
            doc.text(`Nom: ${bon.recipient_first_name} ${bon.recipient_last_name}`, 110, yPos + 5);
            doc.text(`Téléphone: ${bon.recipient_phone}`, 110, yPos + 10);
            doc.text(`CIN: ${bon.recipient_cin}`, 110, yPos + 15);
    
            yPos += 25;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text('Trajet:', 25, yPos);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.text(`${this.sanitizeForPDF(bon.origin)} - ${this.sanitizeForPDF(bon.destination)}`, 45, yPos);
    
            yPos += 10;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(30, 58, 138);
            doc.text('Détails des Bagages', 25, yPos);
    
            yPos += 5;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.rect(25, yPos, 80, 7);
            doc.rect(105, yPos, 80, 7);
            doc.text('Article', 28, yPos + 5);
            doc.text('Quantité', 108, yPos + 5);
    
            yPos += 7;
            doc.setFont('helvetica', 'normal');
            bon.luggage.forEach(item => {
                doc.rect(25, yPos, 80, 7);
                doc.rect(105, yPos, 80, 7);
                doc.text(this.sanitizeForPDF(item.type), 28, yPos + 5);
                doc.text(String(item.quantity), 108, yPos + 5);
                yPos += 7;
            });
    
            yPos += 10;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text('Statut:', 25, yPos);
            doc.text(bon.paid ? 'Payé' : 'Non Payé', 45, yPos, { textColor: bon.paid ? [0, 153, 51] : [255, 0, 0] });
    
            doc.text(`Total: ${bon.total.toFixed(2)} €`, 150, yPos);
    
            doc.save(`bon_${id}.pdf`);
    
        } catch (error) {
            console.error('Error exporting PDF:', error);
            this.showMessage('Erreur lors de la génération du PDF', 'error');
        }
    }

    async loadStatistics(startDate = null, endDate = null) {
        try {
            const token = localStorage.getItem('access_token');
            let url = `${SUPABASE_URL}/rest/v1/bons?user_id=eq.${this.currentUser.id}`;
            
            if (startDate && endDate) {
                url += `&created_at=gte.${startDate}T00:00:00&created_at=lte.${endDate}T23:59:59`;
            }

            const response = await fetch(url, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const bons = await response.json();
                
                let totalRevenue = 0;
                let paidAmount = 0;
                let unpaidAmount = 0;
                let paidCount = 0;
                let unpaidCount = 0;

                bons.forEach(bon => {
                    totalRevenue += parseFloat(bon.total) || 0;
                    if (bon.paid) {
                        paidAmount += parseFloat(bon.total) || 0;
                        paidCount++;
                    } else {
                        unpaidAmount += parseFloat(bon.total) || 0;
                        unpaidCount++;
                    }
                });

                document.getElementById('total-revenue').textContent = `${totalRevenue.toFixed(2)} €`;
                document.getElementById('paid-amount').textContent = `${paidAmount.toFixed(2)} €`;
                document.getElementById('paid-count').textContent = `${paidCount} bons`;
                document.getElementById('unpaid-amount').textContent = `${unpaidAmount.toFixed(2)} €`;
                document.getElementById('unpaid-count').textContent = `${unpaidCount} bons`;
            }
        } catch (error) {
            console.error('Error loading statistics:', error);
        }
    }

    loadSettings() {
        this.loadUsernameFromProfile();
    }

    async loadUsernameFromProfile() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const profiles = await response.json();
                if (profiles.length > 0) {
                    document.getElementById('username-setting').value = profiles[0].username || '';
                }
            }
        } catch (error) {
            console.error('Error loading username:', error);
        }
    }

    async getUsernameFromProfile() {
        try {
            const token = localStorage.getItem('access_token');
            const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                const profiles = await response.json();
                if (profiles.length > 0) {
                    return profiles[0].username;
                }
            }
        } catch (error) {
            console.error('Error getting username:', error);
        }
        return null;
    }

    async saveUsername() {
        const username = document.getElementById('username-setting').value.trim();
        if (username) {
            try {
                const token = localStorage.getItem('access_token');
                
                // Check if profile exists
                const checkResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                    headers: {
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${token}`
                    }
                });

                if (checkResponse.ok) {
                    const profiles = await checkResponse.json();
                    
                    if (profiles.length > 0) {
                        // Update existing profile
                        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${this.currentUser.id}`, {
                            method: 'PATCH',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${token}`,
                                'Prefer': 'return=representation'
                            },
                            body: JSON.stringify({ username: username })
                        });

                        if (updateResponse.ok) {
                            // Update current user data
                            // Update dashboard username
                            document.getElementById('user-name').textContent = username;
                            this.showMessage('Nom d\'utilisateur sauvegardé', 'success');
                        } else {
                            this.showMessage('Erreur lors de la sauvegarde', 'error');
                        }
                    } else {
                        // Create new profile
                        const createResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${token}`,
                                'Prefer': 'return=representation'
                            },
                            body: JSON.stringify({ 
                                id: this.currentUser.id,
                                username: username,
                                full_name: username
                            })
                        });

                        if (createResponse.ok) {
                            // Update dashboard username
                            document.getElementById('user-name').textContent = username;
                            this.showMessage('Nom d\'utilisateur sauvegardé', 'success');
                        } else {
                            this.showMessage('Erreur lors de la sauvegarde', 'error');
                        }
                    }
                }
            } catch (error) {
                console.error('Error updating username:', error);
                this.showMessage('Erreur de connexion', 'error');
            }
        } else {
            this.showMessage('Veuillez entrer un nom d\'utilisateur valide', 'error');
        }
    }

    searchBons(query) {
        if (!query.trim()) {
            this.loadHistory();
            return;
        }

        // This would be implemented with a more complex search in a real app
        // For now, we'll just filter the existing history
        const rows = document.querySelectorAll('#history-table-body tr');
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if (text.includes(query.toLowerCase())) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    handleOnline() {
        this.offlineMode = false;
        this.updateOfflineBanner();
        
        // Try to sync offline data
        this.syncOfflineData();
    }

    handleOffline() {
        this.offlineMode = true;
        this.updateOfflineBanner();
    }

    updateOfflineBanner() {
        const banner = document.getElementById('offline-banner');
        if (this.offlineMode) {
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
        }
    }

    async syncOfflineData() {
        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('sync-bons');
        }
    }

    showMessage(message, type = 'info') {
        // Create a temporary message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${type}`;
        messageEl.textContent = message;
        messageEl.style.position = 'fixed';
        messageEl.style.top = '20px';
        messageEl.style.right = '20px';
        messageEl.style.padding = '10px 20px';
        messageEl.style.borderRadius = '4px';
        messageEl.style.zIndex = '1000';
        
        switch (type) {
            case 'success':
                messageEl.style.backgroundColor = '#d4edda';
                messageEl.style.color = '#155724';
                break;
            case 'error':
                messageEl.style.backgroundColor = '#f8d7da';
                messageEl.style.color = '#721c24';
                break;
            case 'warning':
                messageEl.style.backgroundColor = '#fff3cd';
                messageEl.style.color = '#856404';
                break;
            default:
                messageEl.style.backgroundColor = '#d1ecf1';
                messageEl.style.color = '#0c5460';
        }

        document.body.appendChild(messageEl);
        
        setTimeout(() => {
            messageEl.remove();
        }, 3000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new IMENDITransApp();

    // On page load, restore the view if available, otherwise default to dashboard
    const savedView = localStorage.getItem('currentView');
    if (window.app.currentUser && savedView && document.getElementById(`${savedView}-page`)) {
        window.app.navigateTo(savedView);
    } else if (window.app.currentUser) {
        window.app.navigateTo('dashboard');
    }
});
