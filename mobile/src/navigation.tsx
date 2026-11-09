import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityScreen, TransactionScreen } from './screens/activity';
import { LoginScreen, RegisterScreen, WelcomeScreen } from './screens/auth';
import { HomeScreen } from './screens/home';
import { InsightsScreen } from './screens/insights';
import { ChangePinScreen, DevicesScreen, EditProfileScreen, LimitsScreen, ProfileScreen, VerifyScreen } from './screens/profile';
import { RecipientFormScreen, RecipientsScreen } from './screens/recipients';
import { NewRequestScreen, RequestsScreen } from './screens/requests';
import { SendScreen } from './screens/send';
import { AddMoneyScreen, ExchangeScreen, GoalScreen, GoalsScreen, NewGoalScreen, NewScheduleScreen, NotificationsScreen, RatesScreen, SchedulesScreen } from './screens/wallet';
import type { IconName } from './components/ui';
import { useApp } from './store/app';
import { colors } from './theme';

const Stack = createNativeStackNavigator<any>();
const Tabs = createBottomTabNavigator<any>();

const ICONS: Record<string, IconName> = { Home: 'home', Activity: 'receipt', Goals: 'flag', Profile: 'person' };
const SendPlaceholder = () => <View />;

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.faint,
      tabBarIcon: ({ color, size }) => <Ionicons name={ICONS[route.name]} size={size} color={color} />,
    })}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Activity" component={ActivityScreen} />
      <Tabs.Screen name="SendTab" component={SendPlaceholder} listeners={({ navigation }) => ({ tabPress: (e) => { e.preventDefault(); navigation.navigate('Send'); } })}
        options={{ title: 'Send', tabBarIcon: () => <View style={{ width: 46, height: 46, borderRadius: 23, marginTop: -14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="arrow-up" size={24} color={colors.white} /></View> }} />
      <Tabs.Screen name="Goals" component={GoalsScreen} />
      <Tabs.Screen name="Profile" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const signedIn = useApp((a) => a.signedIn);
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, statusBarStyle: 'dark' }}>
      {!signedIn ? (
        <>
          <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ statusBarStyle: 'light' }} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Send" component={SendScreen} />
          <Stack.Screen name="Transaction" component={TransactionScreen} />
          <Stack.Screen name="Recipients" component={RecipientsScreen} />
          <Stack.Screen name="RecipientForm" component={RecipientFormScreen} />
          <Stack.Screen name="Requests" component={RequestsScreen} />
          <Stack.Screen name="NewRequest" component={NewRequestScreen} />
          <Stack.Screen name="AddMoney" component={AddMoneyScreen} />
          <Stack.Screen name="Exchange" component={ExchangeScreen} />
          <Stack.Screen name="Goal" component={GoalScreen} />
          <Stack.Screen name="NewGoal" component={NewGoalScreen} />
          <Stack.Screen name="Schedules" component={SchedulesScreen} />
          <Stack.Screen name="NewSchedule" component={NewScheduleScreen} />
          <Stack.Screen name="Rates" component={RatesScreen} />
          <Stack.Screen name="Insights" component={InsightsScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} />
          <Stack.Screen name="Verify" component={VerifyScreen} />
          <Stack.Screen name="Limits" component={LimitsScreen} />
          <Stack.Screen name="ChangePin" component={ChangePinScreen} />
          <Stack.Screen name="Devices" component={DevicesScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
