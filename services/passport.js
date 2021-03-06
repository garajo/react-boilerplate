const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const keys = require('../config/keys');
const User = require('../models/User');
const recaptcha = require('./recaptcha');
const account = require('../lib/account');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id).then(user => {
    done(null, user);
  });
});

passport.use(
  'local.signup',
  new LocalStrategy(
    {
      usernameField: 'username',
      passwordField: 'password',
      passReqToCallback: true
    },
    async (req, username, password, done) => {
      req
        .checkBody('email', 'Invalid email')
        .notEmpty()
        .isEmail();

      req.getValidationResult().then(async errors => {
        if (!errors.isEmpty()) {
          var messages = [];
          errors.array().forEach(function(error) {
            messages.push(error.msg);
          });
          return done(null, false, req.flash('error', messages));
        }

        try {
          // validate against database
          let errors = [];
          let user = await User.findOne({ username: username });
          if (user) {
            errors.push({
              param: 'username',
              msg: 'Username already taken, choose a different username'
            });
          }
          user = await User.findOne({ email: req.body.email });
          if (user) {
            errors.push({ param: 'email', msg: 'Email already in use' });
          }
          if (errors.length > 0) {
            var messages = [];
            errors.forEach(function(error) {
              messages.push(error.msg);
            });
            return done(null, false, req.flash('error', messages));
          }

          recaptcha
            .validateRecaptcha(req.body.captcha, req.connection.remoteAddress)
            .then(async () => {
              // add new user
              const admin = await User.findOne({ admin: true });
              let newUser = new User({
                username: username,
                email: req.body.email,
                verified: false,
                admin: !admin,
                login: req.ipAgent,
                registered: req.ipAgent
              });
              newUser.password = newUser.encryptPassword(password);

              newUser = await newUser.save();
              const generatedToken = await account.genToken(
                false,
                newUser,
                req.ipAgent
              );
              if (generatedToken) {
                return done(null, newUser);
              } else {
                return done(
                  null,
                  false,
                  req.flash('error', ['Verification email could not be sent'])
                );
              }
            })
            .catch(e => {
              return done(null, false, req.flash('error', [e.error]));
            });
        } catch (err) {
          return done(err);
        }
      });
    }
  )
);

passport.use(
  'local.signin',
  new LocalStrategy(
    {
      usernameField: 'username',
      passwordField: 'password',
      passReqToCallback: true
    },
    async (req, username, password, done) => {
      req.getValidationResult().then(async errors => {
        if (!errors.isEmpty()) {
          var messages = [];
          errors.array().forEach(function(error) {
            messages.push(error.msg);
          });
          return done(null, false, req.flash('error', messages));
        }
        try {
          let user = await User.findOne({ username: username });
          if (!user || !user.validPassword(password)) {
            return done(
              null,
              false,
              req.flash('error', ['Login failed. Check your username/password'])
            );
          }

          if (!user.verified) {
            return done(
              null,
              false,
              req.flash('error', [
                "Account email hasn't been verified. Check your email for instructions for verifying your email."
              ])
            );
          }

          if (!user.enabled) {
            return done(
              null,
              false,
              req.flash('error', [
                'Account is disabled, please contact us for more information'
              ])
            );
          }

          if (req.session.signInAttempts >= 5) {
            recaptcha
              .validateRecaptcha(req.body.captcha, req.connection.remoteAddress)
              .then(async () => {
                user.login = req.ipAgent;
                user = await user.save();
                return done(null, user);
              })
              .catch(e => {
                return done(null, false, req.flash('error', [e.error]));
              });
          }
          user.login = req.ipAgent;
          user = await user.save();
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      });
    }
  )
);

passport.use(
  new GoogleStrategy(
    {
      clientID: keys.google.client_id,
      clientSecret: keys.google.client_secret,
      callbackURL: keys.redirectDomain + '/auth/google/callback',
      proxy: true,
      passReqToCallback: true
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        let existingUser = await User.findOne({ googleId: profile.id });
        if (existingUser) {
          existingUser.login = req.ipAgent;
          existingUser = await existingUser.save();
          return done(null, existingUser);
        }
        const admin = await User.findOne({ admin: true });

        const user = await new User({
          googleId: profile.id,
          username: profile.name.givenName,
          givenName: profile.name.givenName,
          familyName: profile.name.familyName,
          email: profile.emails[0].value,
          verified: true,
          admin: !admin,
          login: req.ipAgent,
          registered: req.ipAgent
        }).save();
        done(null, user);
      } catch (e) {
        return done(e);
      }
    }
  )
);

passport.use(
  new FacebookStrategy(
    {
      clientID: keys.facebook.client_id,
      clientSecret: keys.facebook.client_secret,
      callbackURL: `${keys.redirectDomain}/auth/facebook/callback`,
      profileFields: ['id', 'displayName', 'photos', 'email'],
      passReqToCallback: true
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        let existingUser = await User.findOne({ facebookId: profile.id });
        if (existingUser) {
          existingUser.login = req.ipAgent;
          existingUser = await existingUser.save();
          return done(null, existingUser);
        }
        const admin = await User.findOne({ admin: true });
        const user = await new User({
          facebookId: profile.id,
          username: profile.displayName,
          email: profile.emails[0].value,
          verified: true,
          admin: !admin,
          login: req.ipAgent,
          registered: req.ipAgent
        }).save();

        done(null, user);
      } catch (e) {
        return done(e);
      }
    }
  )
);

passport.use(
  new TwitterStrategy(
    {
      consumerKey: keys.twitter.consumer_id,
      consumerSecret: keys.twitter.consumer_secret,
      callbackURL: `${keys.redirectDomain}/auth/twitter/callback`,
      userProfileURL:
        'https://api.twitter.com/1.1/account/verify_credentials.json?include_email=true',
      passReqToCallback: true
    },
    async (req, token, tokenSecret, profile, done) => {
      try {
        let existingUser = await User.findOne({ twitterId: profile.id });
        if (existingUser) {
          existingUser.login = req.ipAgent;
          existingUser = await existingUser.save();
          return done(null, existingUser);
        }
        const admin = await User.findOne({ admin: true });

        const user = await new User({
          twitterId: profile.id,
          username: profile.displayName,
          email: profile.emails[0].value,
          verified: true,
          admin: !admin,
          login: req.ipAgent,
          registered: req.ipAgent
        }).save();

        done(null, user);
      } catch (e) {
        return done(e);
      }
    }
  )
);
