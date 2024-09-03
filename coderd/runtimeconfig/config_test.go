package runtimeconfig_test

import (
	"context"
	"testing"

	"github.com/coder/serpent"
	"github.com/stretchr/testify/require"

	"github.com/coder/coder/v2/coderd/coderdtest"
	"github.com/coder/coder/v2/coderd/database/dbmem"
	"github.com/coder/coder/v2/coderd/runtimeconfig"
	"github.com/coder/coder/v2/coderd/util/ptr"
	"github.com/coder/coder/v2/codersdk"
	"github.com/coder/coder/v2/enterprise/coderd/coderdenttest"
	"github.com/coder/coder/v2/enterprise/coderd/license"
	"github.com/coder/coder/v2/testutil"
)

func TestUsage(t *testing.T) {
	t.Run("deployment value without runtimeconfig", func(t *testing.T) {
		t.Parallel()

		var field serpent.StringArray
		opt := serpent.Option{
			Name:        "my deployment value",
			Description: "this mimicks an option we'd define in codersdk/deployment.go",
			Env:         "MY_DEPLOYMENT_VALUE",
			Default:     "pestle,mortar",
			Value:       &field,
		}

		set := serpent.OptionSet{opt}
		require.NoError(t, set.SetDefaults())
		require.Equal(t, []string{"pestle", "mortar"}, field.Value())
	})

	t.Run("deployment value with runtimeconfig", func(t *testing.T) {
		t.Parallel()

		_, altOrg := setup(t)

		ctx := testutil.Context(t, testutil.WaitShort)
		store := dbmem.New()
		resolver := runtimeconfig.NewOrgResolver(altOrg.ID, runtimeconfig.NewStoreResolver(store))
		mutator := runtimeconfig.NewOrgMutator(altOrg.ID, runtimeconfig.NewStoreMutator(store))

		// NOTE: this field is now wrapped
		var field runtimeconfig.Entry[*serpent.HostPort]
		opt := serpent.Option{
			Name:        "my deployment value",
			Description: "this mimicks an option we'd define in codersdk/deployment.go",
			Env:         "MY_DEPLOYMENT_VALUE",
			Default:     "localhost:1234",
			Value:       &field,
		}

		set := serpent.OptionSet{opt}
		require.NoError(t, set.SetDefaults())

		// The value has to now be retrieved from a StartupValue() call.
		require.Equal(t, "localhost:1234", field.StartupValue().String())

		// One new constraint is that we have to set the key on the runtimeconfig.Entry.
		// Attempting to perform any operation which accesses the store will enforce the need for a key.
		_, err := field.Resolve(ctx, resolver)
		require.ErrorIs(t, err, runtimeconfig.ErrKeyNotSet)

		// Let's see that key. The environment var name is likely to be the most stable.
		field.SetKey(opt.Env)

		newVal := serpent.HostPort{Host: "12.34.56.78", Port: "1234"}
		// Now that we've set it, we can update the runtime value of this field, which modifies given store.
		require.NoError(t, field.SetRuntimeValue(ctx, mutator, &newVal))

		// ...and we can retrieve the value, as well.
		resolved, err := field.Resolve(ctx, resolver)
		require.NoError(t, err)
		require.Equal(t, newVal.String(), resolved.String())

		// We can also remove the runtime config.
		require.NoError(t, field.UnsetRuntimeValue(ctx, mutator))
	})
}

// TestConfig demonstrates creating org-level overrides for deployment-level settings.
func TestConfig(t *testing.T) {
	t.Parallel()

	_, altOrg := setup(t)

	t.Run("new", func(t *testing.T) {
		t.Parallel()

		require.Panics(t, func() {
			// "hello" cannot be set on a *serpent.Float64 field.
			runtimeconfig.MustNew[*serpent.Float64]("key", "hello")
		})

		require.NotPanics(t, func() {
			runtimeconfig.MustNew[*serpent.Float64]("key", "91.1234")
		})
	})

	t.Run("zero", func(t *testing.T) {
		t.Parallel()

		// A zero-value declaration of a runtimeconfig.Entry should behave as a zero value of the generic type.
		// NB! A key has not been set for this entry.
		var field runtimeconfig.Entry[*serpent.Bool]
		var zero serpent.Bool
		require.Equal(t, field.StartupValue().Value(), zero.Value())

		// Setting a value will not produce an error.
		require.NoError(t, field.SetStartupValue("true"))

		// But attempting to resolve will produce an error.
		_, err := field.Resolve(context.Background(), runtimeconfig.NewNoopResolver())
		require.ErrorIs(t, err, runtimeconfig.ErrKeyNotSet)
		// But attempting to set the runtime value will produce an error.
		val := serpent.BoolOf(ptr.Ref(true))
		require.ErrorIs(t, field.SetRuntimeValue(context.Background(), runtimeconfig.NewNoopMutator(), val), runtimeconfig.ErrKeyNotSet)
	})

	t.Run("simple", func(t *testing.T) {
		t.Parallel()

		ctx := testutil.Context(t, testutil.WaitShort)
		store := dbmem.New()
		resolver := runtimeconfig.NewOrgResolver(altOrg.ID, runtimeconfig.NewStoreResolver(store))
		mutator := runtimeconfig.NewOrgMutator(altOrg.ID, runtimeconfig.NewStoreMutator(store))

		var (
			base     = serpent.String("system@dev.coder.com")
			override = serpent.String("dogfood@dev.coder.com")
		)

		field := runtimeconfig.MustNew[*serpent.String]("my-field", base.String())
		// Check that default has been set.
		require.Equal(t, base.String(), field.StartupValue().String())
		// Validate that it returns that value.
		require.Equal(t, base.String(), field.String())
		// Validate that there is no org-level override right now.
		_, err := field.Resolve(ctx, resolver)
		require.ErrorIs(t, err, runtimeconfig.EntryNotFound)
		// Coalesce returns the deployment-wide value.
		val, err := field.Coalesce(ctx, resolver)
		require.NoError(t, err)
		require.Equal(t, base.String(), val.String())
		// Set an org-level override.
		require.NoError(t, field.SetRuntimeValue(ctx, mutator, &override))
		// Coalesce now returns the org-level value.
		val, err = field.Coalesce(ctx, resolver)
		require.NoError(t, err)
		require.Equal(t, override.String(), val.String())
	})

	t.Run("complex", func(t *testing.T) {
		t.Parallel()

		ctx := testutil.Context(t, testutil.WaitShort)
		store := dbmem.New()
		resolver := runtimeconfig.NewOrgResolver(altOrg.ID, runtimeconfig.NewStoreResolver(store))
		mutator := runtimeconfig.NewOrgMutator(altOrg.ID, runtimeconfig.NewStoreMutator(store))

		var (
			base = serpent.Struct[map[string]string]{
				Value: map[string]string{"access_type": "offline"},
			}
			override = serpent.Struct[map[string]string]{
				Value: map[string]string{
					"a": "b",
					"c": "d",
				},
			}
		)

		field := runtimeconfig.MustNew[*serpent.Struct[map[string]string]]("my-field", base.String())

		// Check that default has been set.
		require.Equal(t, base.String(), field.StartupValue().String())
		// Validate that there is no org-level override right now.
		_, err := field.Resolve(ctx, resolver)
		require.ErrorIs(t, err, runtimeconfig.EntryNotFound)
		// Coalesce returns the deployment-wide value.
		val, err := field.Coalesce(ctx, resolver)
		require.NoError(t, err)
		require.Equal(t, base.Value, val.Value)
		// Set an org-level override.
		require.NoError(t, field.SetRuntimeValue(ctx, mutator, &override))
		// Coalesce now returns the org-level value.
		structVal, err := field.Resolve(ctx, resolver)
		require.NoError(t, err)
		require.Equal(t, override.Value, structVal.Value)
	})
}

// setup creates a new API, enabled notifications + multi-org experiments, and returns the API client and a new org.
func setup(t *testing.T) (*codersdk.Client, codersdk.Organization) {
	t.Helper()

	vals := coderdtest.DeploymentValues(t)
	vals.Experiments = []string{string(codersdk.ExperimentMultiOrganization)}
	adminClient, _, _, _ := coderdenttest.NewWithAPI(t, &coderdenttest.Options{
		Options: &coderdtest.Options{DeploymentValues: vals},
		LicenseOptions: &coderdenttest.LicenseOptions{
			Features: license.Features{
				codersdk.FeatureMultipleOrganizations: 1,
			},
		},
	})
	return adminClient, coderdenttest.CreateOrganization(t, adminClient, coderdenttest.CreateOrganizationOptions{})
}
