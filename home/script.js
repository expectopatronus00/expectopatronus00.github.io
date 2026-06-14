document.addEventListener('DOMContentLoaded', function() {
    const articles = document.querySelectorAll('.article');
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    const searchButton = document.querySelector('.search-container button');
    const backToTopButton = document.getElementById('back-to-top');
    const themeToggle = document.getElementById('theme-toggle');
    const subscribeBtn = document.getElementById('subscribe-btn');
    const announcementModal = document.getElementById('announcement-modal');
    const closeModal = document.querySelector('.close-modal');
    const dontShowAgain = document.getElementById('dont-show-again');
    const pageLoader = document.querySelector('.page-loader');
    const counters = document.querySelectorAll('.counter');
    const wechatLink = document.getElementById('wechat-link');

    // 页面加载完成后隐藏加载动画
    window.addEventListener('load', function() {
        setTimeout(function() {
            if (pageLoader) {
                pageLoader.style.opacity = '0';
                setTimeout(function() {
                    pageLoader.style.display = 'none';
                }, 500);
            }
        }, 500);
    });

    // 初始化页面
    function initPage() {
        // 设置背景图片 - 使用延迟加载
        const bgImage = new Image();
        bgImage.onload = function() {
            document.body.style.backgroundImage = "url('../others/farm-background.jpg')";
            document.body.style.backgroundSize = 'cover';
            document.body.style.backgroundPosition = 'center';
            document.body.style.backgroundRepeat = 'no-repeat';
            document.body.style.backgroundAttachment = 'fixed';
        };
        bgImage.src = '../others/farm-background.jpg';
        
        // 初始化返回顶部按钮
        initBackToTop();
        
        // 初始化图片延迟加载
        initLazyLoading();
        
        // 初始化主题
        initTheme();
        
        // 初始化访问统计
        initVisitCounter();
        
        // 初始化网站运行时间
        updateSiteRunningTime();
        
        // 显示公告
        showAnnouncement();
        
        // 初始化数字计数动画
        initCounterAnimation();
        
        // 初始化文章卡片动画
        initArticleAnimation();
        
        // 初始化社交媒体链接
        initSocialLinks();
    }

    // 文章点击事件
    function setupArticleClick() {
        articles.forEach(article => {
            article.addEventListener('click', function() {
                const url = this.dataset.url;
                if (url && url !== '#') {
                    // 添加点击动画
                    this.classList.add('clicked');
                    
                    // 延迟跳转，让动画有时间显示
                    setTimeout(() => {
                        window.location.href = url;
                    }, 300);
                }
            });
        });
    }

    // 执行搜索和筛选
    function performSearchAndFilter() {
        const query = searchInput.value.toLowerCase();
        const selectedCategory = categoryFilter.value;
        let matchCount = 0;

        articles.forEach(article => {
            const title = article.querySelector('h2').textContent.toLowerCase();
            const content = article.querySelector('p').textContent.toLowerCase();
            const category = article.querySelector('.category').textContent.toLowerCase();

            const matchesSearch = title.includes(query) || content.includes(query);
            const matchesCategory = !selectedCategory || category.includes(selectedCategory.toLowerCase());

            if (matchesSearch && matchesCategory) {
                article.style.display = 'block';
                // 添加出现动画
                article.classList.add('fade-in');
                matchCount++;
            } else {
                article.style.display = 'none';
                article.classList.remove('fade-in');
            }
        });

        // 显示搜索结果数量
        if (query || selectedCategory) {
            const resultMessage = document.createElement('div');
            resultMessage.className = 'search-result-message';
            resultMessage.textContent = `找到 ${matchCount} 篇相关文章`;
            
            const existingMessage = document.querySelector('.search-result-message');
            if (existingMessage) {
                existingMessage.remove();
            }
            
            document.querySelector('.content').prepend(resultMessage);
        } else {
            const existingMessage = document.querySelector('.search-result-message');
            if (existingMessage) {
                existingMessage.remove();
            }
        }
    }

    // 返回顶部功能
    function initBackToTop() {
        // 监听滚动事件
        window.addEventListener('scroll', function() {
            if (window.pageYOffset > 300) {
                backToTopButton.classList.add('visible');
            } else {
                backToTopButton.classList.remove('visible');
            }
        });

        // 点击返回顶部
        backToTopButton.addEventListener('click', function() {
            // 添加点击动画
            this.classList.add('clicked');
            
            // 平滑滚动到顶部
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
            
            // 移除点击动画
            setTimeout(() => {
                this.classList.remove('clicked');
            }, 300);
        });
    }

    // 图片延迟加载
    function initLazyLoading() {
        // 检查浏览器是否支持IntersectionObserver
        if ('IntersectionObserver' in window) {
            const lazyImages = document.querySelectorAll('img[loading="lazy"]');
            
            const imageObserver = new IntersectionObserver(function(entries, observer) {
                entries.forEach(function(entry) {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        // 添加淡入动画
                        img.style.opacity = '0';
                        img.style.transition = 'opacity 0.5s ease';
                        
                        // 图片加载完成后显示
                        img.onload = function() {
                            img.style.opacity = '1';
                        };
                        
                        imageObserver.unobserve(img);
                    }
                });
            });

            lazyImages.forEach(function(image) {
                imageObserver.observe(image);
            });
        }
    }

    // 主题切换功能
    function initTheme() {
        // 检查本地存储中的主题设置
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
            updateThemeIcon(savedTheme);
        }
        
        // 主题切换按钮点击事件
        themeToggle.addEventListener('click', function() {
            // 添加旋转动画
            this.classList.add('rotate');
            
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            // 应用新主题
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            // 更新图标
            updateThemeIcon(newTheme);
            
            // 移除旋转动画
            setTimeout(() => {
                this.classList.remove('rotate');
            }, 300);
        });
    }
    
    // 更新主题图标
    function updateThemeIcon(theme) {
        const icon = themeToggle.querySelector('i');
        if (theme === 'dark') {
            icon.className = 'fas fa-sun';
        } else {
            icon.className = 'fas fa-moon';
        }
    }
    
    // 访问统计功能
    function initVisitCounter() {
        // 从本地存储获取访问计数
        let visitCount = localStorage.getItem('visitCount') || 0;
        visitCount = parseInt(visitCount) + 1;
        
        // 更新访问计数
        localStorage.setItem('visitCount', visitCount);
        document.getElementById('visit-count').textContent = visitCount;
        document.getElementById('total-visits').textContent = visitCount;
        
        // 更新文章计数
        const articleCount = document.querySelectorAll('.article').length;
        document.getElementById('article-count').textContent = articleCount;
    }
    
    // 更新网站运行时间
    function updateSiteRunningTime() {
        const startDate = new Date('2024-02-23'); // 网站开始运行的日期
        const today = new Date();
        const timeDiff = today.getTime() - startDate.getTime();
        const daysDiff = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        
        document.getElementById('running-days').textContent = daysDiff;
        document.getElementById('site-days').textContent = daysDiff;
    }
    
    // 显示公告弹窗
    function showAnnouncement() {
        // 检查是否已经选择不再显示
        if (localStorage.getItem('dontShowAnnouncement') !== 'true') {
            // 延迟显示公告，让页面先加载完成
            setTimeout(() => {
                announcementModal.style.display = 'block';
                
                // 添加动画类
                const modalContent = announcementModal.querySelector('.modal-content');
                modalContent.classList.add('animate');
            }, 1000);
        }
        
        // 关闭按钮点击事件
        closeModal.addEventListener('click', function() {
            // 添加关闭动画
            const modalContent = announcementModal.querySelector('.modal-content');
            modalContent.style.transform = 'scale(0.9)';
            modalContent.style.opacity = '0';
            
            // 延迟隐藏整个模态框
            setTimeout(() => {
                announcementModal.style.display = 'none';
                // 重置样式，以便下次打开
                modalContent.style.transform = '';
                modalContent.style.opacity = '';
            }, 300);
        });
        
        // 点击模态框外部关闭
        window.addEventListener('click', function(event) {
            if (event.target === announcementModal) {
                // 添加关闭动画
                const modalContent = announcementModal.querySelector('.modal-content');
                modalContent.style.transform = 'scale(0.9)';
                modalContent.style.opacity = '0';
                
                // 延迟隐藏整个模态框
                setTimeout(() => {
                    announcementModal.style.display = 'none';
                    // 重置样式，以便下次打开
                    modalContent.style.transform = '';
                    modalContent.style.opacity = '';
                }, 300);
            }
        });
        
        // 不再显示选项
        dontShowAgain.addEventListener('change', function() {
            if (this.checked) {
                localStorage.setItem('dontShowAnnouncement', 'true');
            } else {
                localStorage.removeItem('dontShowAnnouncement');
            }
        });
    }
    
    // 数字计数动画
    function initCounterAnimation() {
        // 检查是否支持IntersectionObserver
        if ('IntersectionObserver' in window) {
            const counterObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const counter = entry.target;
                        const target = parseInt(counter.textContent);
                        let count = 0;
                        const duration = 2000; // 动画持续时间（毫秒）
                        const interval = 50; // 更新间隔（毫秒）
                        const steps = duration / interval;
                        const increment = target / steps;
                        
                        const timer = setInterval(() => {
                            count += increment;
                            if (count >= target) {
                                counter.textContent = target;
                                clearInterval(timer);
                            } else {
                                counter.textContent = Math.floor(count);
                            }
                        }, interval);
                        
                        // 只执行一次
                        observer.unobserve(counter);
                    }
                });
            });
            
            // 观察所有计数器元素
            counters.forEach(counter => {
                counterObserver.observe(counter);
            });
        }
    }
    
    // 文章卡片动画
    function initArticleAnimation() {
        // 检查是否支持IntersectionObserver
        if ('IntersectionObserver' in window) {
            const articleObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        // 添加淡入和上移动画
                        entry.target.style.opacity = '0';
                        entry.target.style.transform = 'translateY(20px)';
                        entry.target.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                        
                        // 延迟执行，创建错落有致的效果
                        setTimeout(() => {
                            entry.target.style.opacity = '1';
                            entry.target.style.transform = 'translateY(0)';
                        }, 100 * Array.from(articles).indexOf(entry.target) % 5);
                        
                        // 只执行一次
                        observer.unobserve(entry.target);
                    }
                });
            });
            
            // 观察所有文章卡片
            articles.forEach(article => {
                articleObserver.observe(article);
            });
        }
    }
    
    // 订阅功能
    if (subscribeBtn) {
        subscribeBtn.addEventListener('click', function() {
            const email = document.getElementById('subscribe-email').value;
            if (validateEmail(email)) {
                // 添加点击动画
                this.classList.add('clicked');
                
                // 这里可以添加实际的订阅逻辑，如发送到后端API
                // 由于是静态网站，这里只做简单的本地存储演示
                const subscribers = JSON.parse(localStorage.getItem('subscribers') || '[]');
                if (!subscribers.includes(email)) {
                    subscribers.push(email);
                    localStorage.setItem('subscribers', JSON.stringify(subscribers));
                    
                    // 显示成功消息
                    const successMessage = document.createElement('div');
                    successMessage.className = 'subscribe-success';
                    successMessage.innerHTML = '<i class="fas fa-check-circle"></i> 订阅成功！感谢您的关注。';
                    
                    const subscribeForm = document.querySelector('.subscribe-form');
                    subscribeForm.insertAdjacentElement('afterend', successMessage);
                    
                    // 清空输入框
                    document.getElementById('subscribe-email').value = '';
                    
                    // 3秒后移除成功消息
                    setTimeout(() => {
                        successMessage.style.opacity = '0';
                        setTimeout(() => {
                            successMessage.remove();
                        }, 500);
                    }, 3000);
                } else {
                    alert('您已经订阅过了。');
                }
                
                // 移除点击动画
                setTimeout(() => {
                    this.classList.remove('clicked');
                }, 300);
            } else {
                // 显示错误提示
                const emailInput = document.getElementById('subscribe-email');
                emailInput.classList.add('error');
                emailInput.placeholder = '请输入有效的邮箱地址';
                emailInput.value = '';
                
                // 输入框获得焦点时移除错误样式
                emailInput.addEventListener('focus', function() {
                    this.classList.remove('error');
                    this.placeholder = '您的邮箱地址';
                }, { once: true });
            }
        });
    }
    
    // 邮箱验证
    function validateEmail(email) {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(String(email).toLowerCase());
    }

    // 隐私政策点击事件
    document.getElementById('privacy-policy').addEventListener('click', function(e) {
        e.preventDefault();
        
        // 创建模态框
        const privacyModal = document.createElement('div');
        privacyModal.className = 'modal';
        privacyModal.style.display = 'block';
        
        privacyModal.innerHTML = `
            <div class="modal-content">
                <span class="close-modal">&times;</span>
                <h3>隐私政策</h3>
                <div class="privacy-content">
                    <p>本网站尊重并保护所有用户的个人隐私权。本网站不会收集您的个人信息，除非您自愿提供。</p>
                    <p>如果您订阅了我们的更新，您的邮箱地址将仅用于发送博客更新通知，不会用于其他目的或分享给第三方。</p>
                    <p>本网站使用本地存储（localStorage）来保存您的主题偏好、访问统计等信息，这些数据仅存储在您的浏览器中，不会被发送到服务器。</p>
                    <p>本网站可能包含指向第三方网站的链接，这些网站有其自己的隐私政策，本网站对这些网站的内容和隐私做法不负任何责任。</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(privacyModal);
        
        // 关闭按钮点击事件
        privacyModal.querySelector('.close-modal').addEventListener('click', function() {
            // 添加关闭动画
            const modalContent = privacyModal.querySelector('.modal-content');
            modalContent.style.transform = 'scale(0.9)';
            modalContent.style.opacity = '0';
            
            // 延迟移除整个模态框
            setTimeout(() => {
                document.body.removeChild(privacyModal);
            }, 300);
        });
        
        // 点击模态框外部关闭
        privacyModal.addEventListener('click', function(event) {
            if (event.target === privacyModal) {
                // 添加关闭动画
                const modalContent = privacyModal.querySelector('.modal-content');
                modalContent.style.transform = 'scale(0.9)';
                modalContent.style.opacity = '0';
                
                // 延迟移除整个模态框
                setTimeout(() => {
                    document.body.removeChild(privacyModal);
                }, 300);
            }
        });
    });

    // 初始化社交媒体链接
    function initSocialLinks() {
        // 微信链接点击事件
        if (wechatLink) {
            wechatLink.addEventListener('click', function(e) {
                e.preventDefault();
                alert('微信号: expectopatronus00');
            });
        }
    }

    // 事件绑定
    function setupEventListeners() {
        // 搜索按钮点击
        searchButton.addEventListener('click', performSearchAndFilter);

        // 回车键搜索
        searchInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                performSearchAndFilter();
            }
        });

        // 分类筛选变化
        categoryFilter.addEventListener('change', performSearchAndFilter);
        
        // 搜索输入框获得焦点时添加动画
        searchInput.addEventListener('focus', function() {
            this.parentElement.classList.add('focused');
        });
        
        // 搜索输入框失去焦点时移除动画
        searchInput.addEventListener('blur', function() {
            this.parentElement.classList.remove('focused');
        });
    }

    // 初始化
    initPage();
    setupArticleClick();
    setupEventListeners();
});
