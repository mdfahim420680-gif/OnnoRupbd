import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './app/store';
import { useAppDispatch, useAppSelector } from './app/hooks';
import { fetchCurrentUser, setUserProfile } from './features/auth/authSlice';
import { fetchServerCart, resetToGuestCart } from './features/cart/cartSlice';
import {
  hydrateGuestWishlist,
  mergeGuestWishlistAsync,
  resetToGuestWishlist,
} from './features/wishlist/wishlistSlice';
import { registerUnauthorizedHandler } from './services/api';
import { StorefrontLayout } from './layouts/StorefrontLayout';
import { AuthLayout } from './layouts/AuthLayout';
import { AdminShellWrapper } from './layouts/AdminLayout';
import { AdminProvider } from './components/admin/AdminContext';
import { adminChunkLoaders } from './lib/adminRouteChunks';
import { AuthModal } from './features/auth/AuthModal';
import { CartDrawer } from './features/cart/CartDrawer';
import { ToastContainer } from './components/feedback/ToastContainer';
import { ErrorBoundary } from './components/feedback/ErrorBoundary';
import { PageReloadProgress } from './components/feedback/PageReloadProgress';
import { GlobalPromotionalPopupHost } from './components/promotional/GlobalPromotionalPopupHost';

const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })));
const ShopPage = lazy(() => import('./pages/ShopPage').then((m) => ({ default: m.ShopPage })));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })));
const CartPage = lazy(() => import('./pages/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const OrderSuccessPage = lazy(() => import('./pages/OrderSuccessPage').then((m) => ({ default: m.OrderSuccessPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ResetPasswordPage = lazy(() => import('./pages/AuthUtilityPages').then((m) => ({ default: m.ResetPasswordPage })));
const VerifyEmailPage = lazy(() => import('./pages/AuthUtilityPages').then((m) => ({ default: m.VerifyEmailPage })));
const WishlistPage = lazy(() => import('./pages/WishlistPage').then((m) => ({ default: m.WishlistPage })));
const AccountProfilePage = lazy(() => import('./pages/AccountPages').then((m) => ({ default: m.AccountProfilePage })));
const CustomerOrderDetailPage = lazy(() => import('./pages/AccountPages').then((m) => ({ default: m.OrderDetailPage })));
const OrderHistoryPage = lazy(() => import('./pages/AccountPages').then((m) => ({ default: m.OrderHistoryPage })));
const SavedAddressesPage = lazy(() => import('./pages/AccountPages').then((m) => ({ default: m.SavedAddressesPage })));
const AccountDashboardPage = lazy(() => import('./pages/account/CustomerAccountModules').then((m) => ({ default: m.AccountDashboardPage })));
const AccountSecurityPage = lazy(() => import('./pages/account/CustomerAccountModules').then((m) => ({ default: m.AccountSecurityPage })));
const MyCouponsPage = lazy(() => import('./pages/account/CustomerAccountModules').then((m) => ({ default: m.MyCouponsPage })));
const MyReviewsPage = lazy(() => import('./pages/account/CustomerAccountModules').then((m) => ({ default: m.MyReviewsPage })));
const MyWalletPage = lazy(() => import('./pages/account/CustomerAccountModules').then((m) => ({ default: m.MyWalletPage })));
const AboutPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.AboutPage })));
const BlogDetailPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.BlogDetailPage })));
const BlogListPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.BlogListPage })));
const CmsStaticPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.CmsStaticPage })));
const ContactPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.ContactPage })));
const FaqPublicPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.FaqPublicPage })));
const NotFoundPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.NotFoundPage })));
const OffersPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.OffersPage })));
const TrackOrderPage = lazy(() => import('./pages/SupportAndInfoPages').then((m) => ({ default: m.TrackOrderPage })));

// Route-level admin chunks preserve the existing admin modules while keeping them out of the storefront entry bundle.
const DashboardPage = lazy(adminChunkLoaders.dashboard);
const ProductsListPage = lazy(adminChunkLoaders.productsList);
const ProductFormPage = lazy(adminChunkLoaders.productForm);
const AdminProductDetailPage = lazy(adminChunkLoaders.productDetail);
const AttributesPage = lazy(adminChunkLoaders.attributes);
const CategoriesListPage = lazy(adminChunkLoaders.categoriesList);
const CategoryFormPage = lazy(adminChunkLoaders.categoryForm);
const BrandsListPage = lazy(adminChunkLoaders.brandsList);
const BrandFormPage = lazy(adminChunkLoaders.brandForm);
const InventoryListPage = lazy(adminChunkLoaders.inventoryList);
const InventoryAdjustmentsPage = lazy(adminChunkLoaders.inventoryAdjustments);
const InventoryHistoryPage = lazy(adminChunkLoaders.inventoryHistory);
const HeroSlidesListPage = lazy(adminChunkLoaders.heroSlidesList);
const HeroSlideFormPage = lazy(adminChunkLoaders.heroSlideForm);
const CartHeroSliderPage = lazy(adminChunkLoaders.cartHeroSlider);
const CheckoutHeroSliderPage = lazy(adminChunkLoaders.checkoutHeroSlider);
const WishlistHeroSliderPage = lazy(adminChunkLoaders.wishlistHeroSlider);
const BannersListPage = lazy(adminChunkLoaders.bannersList);
const BannerFormPage = lazy(adminChunkLoaders.bannerForm);
const AdvertisementsListPage = lazy(adminChunkLoaders.advertisementsList);
const AdvertisementFormPage = lazy(adminChunkLoaders.advertisementForm);
const OrdersListPage = lazy(adminChunkLoaders.ordersList);
const AdminOrderDetailPage = lazy(adminChunkLoaders.orderDetail);
const CancellationRequestsPage = lazy(adminChunkLoaders.cancellationRequests);
const ReturnsRefundsPage = lazy(adminChunkLoaders.returnsRefunds);
const PaymentTransactionsPage = lazy(adminChunkLoaders.paymentTransactions);
const CustomersListPage = lazy(adminChunkLoaders.customersList);
const CustomerDetailPage = lazy(adminChunkLoaders.customerDetail);
const CustomerGroupsPage = lazy(adminChunkLoaders.customerGroups);
const ReviewsListPage = lazy(adminChunkLoaders.reviewsList);
const ReviewDetailPage = lazy(adminChunkLoaders.reviewDetail);
const CouponsListPage = lazy(adminChunkLoaders.couponsList);
const CouponFormPage = lazy(adminChunkLoaders.couponForm);
const DiscountRulesPage = lazy(adminChunkLoaders.discountRules);
const CampaignsPage = lazy(adminChunkLoaders.campaigns);
const NavigationManagerPage = lazy(adminChunkLoaders.navigationManager);
const HomepageCmsPage = lazy(adminChunkLoaders.homepageCms);
const HomepageSectionsPage = lazy(adminChunkLoaders.homepageSections);
const PromotionalPopupsPage = lazy(adminChunkLoaders.promotionalPopups);
const GlobalPromotionalPopupsPage = lazy(adminChunkLoaders.globalPromotionalPopup);
const StaticPagesPage = lazy(adminChunkLoaders.staticPages);
const FaqManagementPage = lazy(adminChunkLoaders.faqManagement);
const BlogManagementPage = lazy(adminChunkLoaders.blogManagement);
const SupportEnquiriesPage = lazy(adminChunkLoaders.supportEnquiries);
const GeneralSettingsPage = lazy(adminChunkLoaders.generalSettings);
const HeaderSettingsPage = lazy(adminChunkLoaders.headerSettings);
const FooterSettingsPage = lazy(adminChunkLoaders.footerSettings);
const SocialLinksPage = lazy(adminChunkLoaders.socialLinks);
const AnnouncementSettingsPage = lazy(adminChunkLoaders.announcementSettings);
const SeoSettingsPage = lazy(adminChunkLoaders.seoSettings);
const PaymentMethodsPage = lazy(adminChunkLoaders.paymentMethods);
const ShippingSettingsPage = lazy(adminChunkLoaders.shippingSettings);
const DeliveryZonesPage = lazy(adminChunkLoaders.deliveryZones);
const TaxSettingsPage = lazy(adminChunkLoaders.taxSettings);
const EmailSettingsPage = lazy(adminChunkLoaders.emailSettings);
const NotificationsSettingsPage = lazy(adminChunkLoaders.notificationsSettings);
const SecuritySettingsPage = lazy(adminChunkLoaders.securitySettings);
const AnalyticsReportPage = lazy(adminChunkLoaders.analyticsReport);
const AdminUsersPage = lazy(adminChunkLoaders.adminUsers);
const RolesPage = lazy(adminChunkLoaders.roles);
const PermissionsPage = lazy(adminChunkLoaders.permissions);
const AuditLogsPage = lazy(adminChunkLoaders.auditLogs);
const SystemLogsPage = lazy(adminChunkLoaders.systemLogs);
const SystemHealthPage = lazy(adminChunkLoaders.systemHealth);

function AppBootstrap() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const { user, initialized, sessionOrigin } = useAppSelector((s) => s.auth);
  const syncedStorefrontUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      syncedStorefrontUserIdRef.current = null;
      dispatch(setUserProfile(null));
      dispatch(resetToGuestCart());
      dispatch(resetToGuestWishlist());
    });
    return () => registerUnauthorizedHandler(null);
  }, [dispatch]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('resetToken');
    const resetEmail = params.get('email');
    if (resetToken && resetEmail) {
      window.history.replaceState(
        null,
        '',
        `/reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(resetEmail)}`,
      );
    } else if (params.get('oauth') === 'success') {
      params.delete('oauth');
      const cleaned = params.toString();
      window.history.replaceState(null, '', cleaned ? `${window.location.pathname}?${cleaned}` : window.location.pathname);
    }
    dispatch(fetchCurrentUser());
  }, [dispatch]);

  const pathnameLower = location.pathname.toLowerCase();
  const isAdminRoute = pathnameLower === '/admin' || pathnameLower.startsWith('/admin/');

  useEffect(() => {
    if (user) {
      if (isAdminRoute) {
        return;
      }
      if (syncedStorefrontUserIdRef.current === user.id) {
        return;
      }
      syncedStorefrontUserIdRef.current = user.id;
      // loginUser / registerUser / completeOAuthSession already merged cart & wishlist
      if (sessionOrigin !== 'auth') {
        dispatch(fetchServerCart());
        dispatch(mergeGuestWishlistAsync());
      }
    } else if (initialized) {
      syncedStorefrontUserIdRef.current = null;
      if (!isAdminRoute) {
        dispatch(hydrateGuestWishlist());
      }
    }
  }, [dispatch, user, initialized, isAdminRoute, sessionOrigin]);

  return null;
}

function AdminRouteScope() {
  return (
    <AdminProvider>
      <AdminShellWrapper>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Outlet />
        </Suspense>
      </AdminShellWrapper>
    </AdminProvider>
  );
}

const STANDALONE_AUTH_PATHS = new Set([
  '/login',
  '/signin',
  '/register',
  '/signup',
  '/forgot-password',
  '/verify-email',
  '/reset-password',
]);

function GlobalOverlays() {
  const location = useLocation();
  const pathnameLower = location.pathname.toLowerCase();
  const isStandaloneAuthRoute = STANDALONE_AUTH_PATHS.has(pathnameLower);
  const isAdminRoute = pathnameLower === '/admin' || pathnameLower.startsWith('/admin/');
  return (
    <>
      <PageReloadProgress />
      {!isStandaloneAuthRoute && <AuthModal />}
      {!isStandaloneAuthRoute && <CartDrawer />}
      {!isStandaloneAuthRoute && !isAdminRoute && <GlobalPromotionalPopupHost />}
      <ToastContainer />
    </>
  );
}

function GlobalRouteScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const isInitialLocation = useRef(true);
  const scrollPositions = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const isInitial = isInitialLocation.current;
    isInitialLocation.current = false;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';

    if (isInitial || navigationType !== 'POP') {
      window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, scrollPositions.current.get(location.key) ?? 0);
    }
    return () => {
      history.scrollRestoration = previousRestoration;
    };
  }, [location.key, navigationType]);

  useEffect(() => {
    const savePosition = () => {
      scrollPositions.current.set(location.key, window.scrollY);
    };
    window.addEventListener('scroll', savePosition, { passive: true });
    savePosition();
    return () => window.removeEventListener('scroll', savePosition);
  }, [location.key]);

  return null;
}

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-label="Loading page">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#145CFF]" />
    </div>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppBootstrap />
          <GlobalRouteScrollManager />
          <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
          {/* Storefront Customer Routes */}
          <Route
            path="/"
            element={
              <StorefrontLayout>
                <HomePage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/shop"
            element={
              <StorefrontLayout>
                <ShopPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/category/:slug"
            element={
              <StorefrontLayout>
                <ShopPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/product/:slug"
            element={
              <StorefrontLayout>
                <ProductDetailPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/offers"
            element={
              <StorefrontLayout>
                <OffersPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/blog"
            element={
              <StorefrontLayout>
                <BlogListPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/blog/:slug"
            element={
              <StorefrontLayout>
                <BlogDetailPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/faqs"
            element={
              <StorefrontLayout>
                <FaqPublicPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/about"
            element={
              <StorefrontLayout>
                <AboutPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/cart"
            element={
              <StorefrontLayout>
                <CartPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/checkout"
            element={
              <StorefrontLayout>
                <CheckoutPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/order-success/:id"
            element={
              <StorefrontLayout>
                <OrderSuccessPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/checkout/success/:id"
            element={
              <StorefrontLayout>
                <OrderSuccessPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/wishlist"
            element={
              <StorefrontLayout>
                <WishlistPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/track-order"
            element={
              <StorefrontLayout>
                <TrackOrderPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/contact"
            element={
              <StorefrontLayout>
                <ContactPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/pages/:slug"
            element={
              <StorefrontLayout>
                <CmsStaticPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account"
            element={
              <StorefrontLayout>
                <AccountProfilePage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/orders"
            element={
              <StorefrontLayout>
                <OrderHistoryPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/orders/:id"
            element={
              <StorefrontLayout>
                <CustomerOrderDetailPage />
              </StorefrontLayout>
            }
          />
          {/* Isolated Full-Screen Authentication Routes (No Storefront Header / Footer) */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage initialMode="login" />} />
            <Route path="/signin" element={<LoginPage initialMode="login" />} />
            <Route path="/forgot-password" element={<LoginPage initialMode="forgot" />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/signup" element={<RegisterPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
          <Route
            path="/account/addresses"
            element={
              <StorefrontLayout>
                <SavedAddressesPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/dashboard"
            element={
              <StorefrontLayout>
                <AccountDashboardPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/reviews"
            element={
              <StorefrontLayout>
                <MyReviewsPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/coupons"
            element={
              <StorefrontLayout>
                <MyCouponsPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/wallet"
            element={
              <StorefrontLayout>
                <MyWalletPage />
              </StorefrontLayout>
            }
          />
          <Route
            path="/account/security"
            element={
              <StorefrontLayout>
                <AccountSecurityPage />
              </StorefrontLayout>
            }
          />
          <Route path="/account/profile" element={<Navigate to="/account" replace />} />
          <Route path="/account/settings" element={<Navigate to="/account" replace />} />

          {/* Admin Operations Portal Routes */}
          <Route element={<AdminRouteScope />}>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin/dashboard" element={<DashboardPage />} />

            {/* Products, Categories, Brands & Attributes */}
            <Route path="/admin/products" element={<ProductsListPage />} />
            <Route path="/admin/products/new" element={<ProductFormPage />} />
            <Route path="/admin/products/:id" element={<AdminProductDetailPage />} />
            <Route path="/admin/products/:id/edit" element={<ProductFormPage />} />

            <Route path="/admin/categories" element={<CategoriesListPage />} />
            <Route path="/admin/categories/new" element={<CategoryFormPage />} />
            <Route path="/admin/categories/:id/edit" element={<CategoryFormPage />} />

            <Route path="/admin/brands" element={<BrandsListPage />} />
            <Route path="/admin/brands/new" element={<BrandFormPage />} />
            <Route path="/admin/brands/:id/edit" element={<BrandFormPage />} />

            <Route path="/admin/attributes" element={<AttributesPage />} />
            <Route path="/admin/attribute-groups" element={<AttributesPage defaultTab="groups" />} />

            {/* Inventory Management */}
            <Route path="/admin/inventory" element={<InventoryListPage />} />
            <Route path="/admin/inventory/adjustments" element={<InventoryAdjustmentsPage />} />
            <Route path="/admin/inventory/history" element={<InventoryHistoryPage />} />

            {/* Marketing & Merchandising */}
            <Route path="/admin/hero-slides" element={<HeroSlidesListPage />} />
            <Route path="/admin/hero-slides/new" element={<HeroSlideFormPage />} />
            <Route path="/admin/hero-slides/:id/edit" element={<HeroSlideFormPage />} />
            <Route path="/admin/cart-hero-slider" element={<CartHeroSliderPage />} />
            <Route path="/admin/checkout-hero-slider" element={<CheckoutHeroSliderPage />} />
            <Route path="/admin/wishlist-hero-slider" element={<WishlistHeroSliderPage />} />
            <Route path="/admin/banners" element={<BannersListPage />} />
            <Route path="/admin/banners/new" element={<BannerFormPage />} />
            <Route path="/admin/banners/:id/edit" element={<BannerFormPage />} />

            <Route path="/admin/advertisements" element={<AdvertisementsListPage />} />
            <Route path="/admin/advertisements/new" element={<AdvertisementFormPage />} />
            <Route path="/admin/advertisements/:id/edit" element={<AdvertisementFormPage />} />

            <Route path="/admin/marketing/campaigns" element={<CampaignsPage />} />
            <Route path="/admin/marketing/global-promotional-popup" element={<GlobalPromotionalPopupsPage />} />
            <Route path="/admin/navigation" element={<NavigationManagerPage />} />
            <Route path="/admin/cms/popups" element={<PromotionalPopupsPage />} />

            {/* Sales, Orders, Returns & Payments */}
            <Route path="/admin/orders" element={<OrdersListPage />} />
            <Route path="/admin/orders/pending" element={<OrdersListPage initialStatusGroup="pending" />} />
            <Route path="/admin/orders/processing" element={<OrdersListPage initialStatusGroup="processing" />} />
            <Route path="/admin/orders/shipped" element={<OrdersListPage initialStatusGroup="shipped" />} />
            <Route path="/admin/orders/delivered" element={<OrdersListPage initialStatusGroup="delivered" />} />
            <Route path="/admin/orders/cancelled" element={<OrdersListPage initialStatusGroup="cancelled" />} />
            <Route path="/admin/orders/cancellation-requests" element={<CancellationRequestsPage />} />
            <Route path="/admin/orders/:id" element={<AdminOrderDetailPage />} />
            <Route path="/admin/returns" element={<ReturnsRefundsPage />} />
            <Route path="/admin/payments" element={<PaymentTransactionsPage />} />

            {/* Customers, Reviews & Support */}
            <Route path="/admin/customers" element={<CustomersListPage />} />
            <Route path="/admin/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/admin/customer-groups" element={<CustomerGroupsPage />} />
            <Route path="/admin/reviews" element={<ReviewsListPage />} />
            <Route path="/admin/reviews/:id" element={<ReviewDetailPage />} />
            <Route path="/admin/support" element={<SupportEnquiriesPage />} />

            {/* Coupons & Offers */}
            <Route path="/admin/coupons" element={<CouponsListPage />} />
            <Route path="/admin/coupons/new" element={<CouponFormPage />} />
            <Route path="/admin/coupons/:id/edit" element={<CouponFormPage />} />
            <Route path="/admin/discount-rules" element={<DiscountRulesPage />} />
            <Route path="/admin/special-offers" element={<CampaignsPage defaultType="special_offer" />} />
            <Route path="/admin/flash-sales" element={<CampaignsPage defaultType="flash_sale" />} />

            {/* Content & Website Settings */}
            <Route path="/admin/homepage-layout" element={<HomepageSectionsPage />} />
            <Route path="/admin/cms/homepage" element={<HomepageCmsPage />} />
            <Route path="/admin/cms/sections" element={<HomepageSectionsPage />} />
            <Route path="/admin/cms/pages" element={<StaticPagesPage />} />
            <Route path="/admin/cms/faqs" element={<FaqManagementPage />} />
            <Route path="/admin/cms/blogs" element={<BlogManagementPage />} />

            <Route path="/admin/settings/header" element={<HeaderSettingsPage />} />
            <Route path="/admin/settings/footer" element={<FooterSettingsPage />} />
            <Route path="/admin/settings/announcement" element={<AnnouncementSettingsPage />} />
            <Route path="/admin/settings/social-links" element={<SocialLinksPage />} />

            {/* Payments, Shipping, Tax & System Settings */}
            <Route path="/admin/payments/methods" element={<PaymentMethodsPage />} />
            <Route path="/admin/shipping" element={<ShippingSettingsPage />} />
            <Route path="/admin/shipping/zones" element={<DeliveryZonesPage />} />
            <Route path="/admin/settings/tax" element={<TaxSettingsPage />} />
            <Route path="/admin/settings/general" element={<GeneralSettingsPage />} />
            <Route path="/admin/settings/email" element={<EmailSettingsPage />} />
            <Route path="/admin/settings/notifications" element={<NotificationsSettingsPage />} />
            <Route path="/admin/settings/seo" element={<SeoSettingsPage />} />
            <Route path="/admin/settings/security" element={<SecuritySettingsPage />} />

            {/* Reports & Analytics */}
            <Route path="/admin/analytics/sales" element={<AnalyticsReportPage metric="sales" />} />
            <Route path="/admin/analytics/revenue" element={<AnalyticsReportPage metric="revenue" />} />
            <Route path="/admin/analytics/products" element={<AnalyticsReportPage metric="products" />} />
            <Route path="/admin/analytics/customers" element={<AnalyticsReportPage metric="customers" />} />
            <Route path="/admin/analytics/inventory" element={<AnalyticsReportPage metric="inventory" />} />

            {/* Admin Users, RBAC, Logs & System Health */}
            <Route path="/admin/admin-users" element={<AdminUsersPage />} />
            <Route path="/admin/roles" element={<RolesPage />} />
            <Route path="/admin/permissions" element={<PermissionsPage />} />
            <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
            <Route path="/admin/system-logs" element={<SystemLogsPage />} />
            <Route path="/admin/system-health" element={<SystemHealthPage />} />

            {/* Legacy Route Redirects */}
            <Route path="/admin/stock" element={<Navigate to="/admin/inventory/adjustments" replace />} />
            <Route path="/admin/marketing/hero" element={<Navigate to="/admin/hero-slides" replace />} />
            <Route path="/admin/marketing/banners" element={<Navigate to="/admin/banners" replace />} />
            <Route path="/admin/ads" element={<Navigate to="/admin/advertisements" replace />} />
            <Route path="/admin/marketing/navigation" element={<Navigate to="/admin/navigation" replace />} />
            <Route path="/admin/marketing/popups" element={<Navigate to="/admin/cms/popups" replace />} />
            <Route path="/admin/cms" element={<Navigate to="/admin/cms/sections" replace />} />
            <Route path="/admin/cms/about" element={<Navigate to="/admin/cms/pages" replace />} />
            <Route path="/admin/cms/contact" element={<Navigate to="/admin/settings/social-links" replace />} />
            <Route path="/admin/website/header" element={<Navigate to="/admin/settings/header" replace />} />
            <Route path="/admin/website/footer" element={<Navigate to="/admin/settings/footer" replace />} />
            <Route path="/admin/website/navigation" element={<Navigate to="/admin/navigation" replace />} />
            <Route path="/admin/website/announcement" element={<Navigate to="/admin/settings/announcement" replace />} />
            <Route path="/admin/website/social" element={<Navigate to="/admin/settings/social-links" replace />} />
            <Route path="/admin/shipping/methods" element={<Navigate to="/admin/shipping" replace />} />
            <Route path="/admin/shipping/charges" element={<Navigate to="/admin/shipping" replace />} />
            <Route path="/admin/tax" element={<Navigate to="/admin/settings/tax" replace />} />
            <Route path="/admin/reports" element={<Navigate to="/admin/analytics/sales" replace />} />
            <Route path="/admin/reports/revenue" element={<Navigate to="/admin/analytics/revenue" replace />} />
            <Route path="/admin/reports/products" element={<Navigate to="/admin/analytics/products" replace />} />
            <Route path="/admin/reports/customers" element={<Navigate to="/admin/analytics/customers" replace />} />
            <Route path="/admin/reports/inventory" element={<Navigate to="/admin/analytics/inventory" replace />} />
            <Route path="/admin/settings" element={<Navigate to="/admin/settings/general" replace />} />
            <Route path="/admin/settings/store" element={<Navigate to="/admin/settings/general" replace />} />
            <Route path="/admin/settings/currency" element={<Navigate to="/admin/settings/general" replace />} />
            <Route path="/admin/staff" element={<Navigate to="/admin/admin-users" replace />} />
            <Route path="/admin/audit" element={<Navigate to="/admin/audit-logs" replace />} />
            <Route path="/admin/logs" element={<Navigate to="/admin/system-logs" replace />} />
          </Route>

          {/* 404 Fallback */}
          <Route
            path="*"
            element={
              <StorefrontLayout>
                <NotFoundPage />
              </StorefrontLayout>
            }
          />
          </Routes>
          </Suspense>

          {/* Global Overlays */}
          <GlobalOverlays />
        </ErrorBoundary>
      </BrowserRouter>
    </Provider>
  );
}
